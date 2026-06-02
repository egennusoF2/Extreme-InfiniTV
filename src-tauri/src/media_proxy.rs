use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::OnceLock,
    time::Duration,
};

use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};

const DEFAULT_USER_AGENT: &str = "VLC/3.0.20 LibVLC/3.0.20";

static PORT: OnceLock<u16> = OnceLock::new();

#[tauri::command]
pub fn media_proxy_url(
    url: String,
    user_agent: Option<String>,
    referer: Option<String>,
) -> Result<String, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("invalid media url".into());
    }
    let port = ensure_server()?;
    let encoded = utf8_percent_encode(&url, NON_ALPHANUMERIC).to_string();
    let mut out = format!("http://127.0.0.1:{port}/stream?url={encoded}");
    if let Some(user_agent) = user_agent.filter(|v| !v.trim().is_empty()) {
        out.push_str("&ua=");
        out.push_str(&utf8_percent_encode(user_agent.trim(), NON_ALPHANUMERIC).to_string());
    }
    if let Some(referer) = referer.filter(|v| !v.trim().is_empty()) {
        out.push_str("&referer=");
        out.push_str(&utf8_percent_encode(referer.trim(), NON_ALPHANUMERIC).to_string());
    }
    Ok(out)
}

fn ensure_server() -> Result<u16, String> {
    if let Some(port) = PORT.get() {
        return Ok(*port);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let _ = PORT.set(port);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let _ = handle_client(stream);
            });
        }
    });
    Ok(port)
}

fn handle_client(mut stream: TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;

    let mut request = Vec::new();
    let mut buf = [0_u8; 4096];
    loop {
        let read = stream.read(&mut buf)?;
        if read == 0 {
            return Ok(());
        }
        request.extend_from_slice(&buf[..read]);
        if request.windows(4).any(|w| w == b"\r\n\r\n") || request.len() > 64 * 1024 {
            break;
        }
    }

    let request = String::from_utf8_lossy(&request);
    let mut lines = request.split("\r\n");
    let first = lines.next().unwrap_or_default();
    let mut first_parts = first.split_whitespace();
    let method = first_parts.next().unwrap_or_default();
    let path = first_parts.next().unwrap_or_default();
    let headers = parse_headers(lines);

    if method == "OPTIONS" {
        write_empty(&mut stream, 204, "No Content", &[])?;
        return Ok(());
    }
    if method != "GET" && method != "HEAD" {
        write_text(&mut stream, 405, "Method Not Allowed", "method not allowed")?;
        return Ok(());
    }

    let target = target_request(path);
    let Some(url) = target.url else {
        write_text(&mut stream, 400, "Bad Request", "missing url")?;
        return Ok(());
    };
    if !url.starts_with("http://") && !url.starts_with("https://") {
        write_text(&mut stream, 400, "Bad Request", "invalid url")?;
        return Ok(());
    }

    match fetch_upstream(
        &url,
        method,
        headers.get("range").map(String::as_str),
        target.user_agent.as_deref(),
        target.referer.as_deref(),
    ) {
        Ok(upstream) => {
            write_upstream(&mut stream, method, upstream)?;
        }
        Err(error) => {
            write_text(
                &mut stream,
                502,
                "Bad Gateway",
                &format!("upstream error: {error}"),
            )?;
        }
    }
    Ok(())
}

fn parse_headers<'a>(lines: impl Iterator<Item = &'a str>) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    headers
}

struct TargetRequest {
    url: Option<String>,
    user_agent: Option<String>,
    referer: Option<String>,
}

fn decode_query_value(value: &str) -> Option<String> {
    percent_decode_str(value)
        .decode_utf8()
        .ok()
        .map(|v| v.to_string())
}

fn target_request(path: &str) -> TargetRequest {
    let mut target = TargetRequest {
        url: None,
        user_agent: None,
        referer: None,
    };
    let Some(query) = path.split_once('?').map(|v| v.1) else {
        return target;
    };
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match key {
            "url" => target.url = decode_query_value(value),
            "ua" => target.user_agent = decode_query_value(value),
            "referer" => target.referer = decode_query_value(value),
            _ => {}
        }
    }
    target
}

fn origin_for(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    Some(format!("{}://{}/", parsed.scheme(), parsed.host_str()?))
}

fn fetch_upstream(
    url: &str,
    method: &str,
    range: Option<&str>,
    user_agent: Option<&str>,
    referer: Option<&str>,
) -> Result<reqwest::blocking::Response, reqwest::Error> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(25))
        .build()?;
    let request_method = if method == "HEAD" {
        reqwest::Method::HEAD
    } else {
        reqwest::Method::GET
    };
    let ua = user_agent
        .filter(|v| !v.trim().is_empty())
        .unwrap_or(DEFAULT_USER_AGENT);
    let mut request = client
        .request(request_method.clone(), url)
        .header(reqwest::header::USER_AGENT, ua);
    if let Some(range) = range.filter(|v| !v.trim().is_empty()) {
        request = request.header(reqwest::header::RANGE, range);
    }
    if let Some(referer) = referer
        .filter(|v| !v.trim().is_empty())
        .map(str::to_string)
        .or_else(|| origin_for(url))
    {
        request = request.header(reqwest::header::REFERER, referer);
    }
    let response = request.send()?;
    if response.status().is_server_error() && url.starts_with("https://") {
        let fallback = url.replacen("https://", "http://", 1);
        let mut fallback_request = client
            .request(request_method, fallback)
            .header(reqwest::header::USER_AGENT, ua);
        if let Some(range) = range.filter(|v| !v.trim().is_empty()) {
            fallback_request = fallback_request.header(reqwest::header::RANGE, range);
        }
        if let Some(referer) = referer
            .filter(|v| !v.trim().is_empty())
            .map(str::to_string)
            .or_else(|| origin_for(url))
        {
            fallback_request = fallback_request.header(reqwest::header::REFERER, referer);
        }
        if let Ok(fallback_response) = fallback_request.send() {
            return Ok(fallback_response);
        }
    }
    Ok(response)
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        206 => "Partial Content",
        400 => "Bad Request",
        405 => "Method Not Allowed",
        416 => "Range Not Satisfiable",
        502 => "Bad Gateway",
        _ => "OK",
    }
}

fn write_common_headers(stream: &mut TcpStream, status: u16, reason: &str) -> std::io::Result<()> {
    write!(stream, "HTTP/1.1 {status} {reason}\r\n")?;
    write!(stream, "Access-Control-Allow-Origin: *\r\n")?;
    write!(
        stream,
        "Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n"
    )?;
    write!(stream, "Connection: close\r\n")?;
    Ok(())
}

fn write_empty(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    extra_headers: &[(&str, String)],
) -> std::io::Result<()> {
    write_common_headers(stream, status, reason)?;
    for (key, value) in extra_headers {
        write!(stream, "{key}: {value}\r\n")?;
    }
    write!(stream, "Content-Length: 0\r\n\r\n")?;
    stream.flush()
}

fn write_text(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    text: &str,
) -> std::io::Result<()> {
    write_common_headers(stream, status, reason)?;
    write!(stream, "Content-Type: text/plain; charset=utf-8\r\n")?;
    write!(stream, "Content-Length: {}\r\n\r\n", text.len())?;
    stream.write_all(text.as_bytes())?;
    stream.flush()
}

fn write_upstream(
    stream: &mut TcpStream,
    method: &str,
    response: reqwest::blocking::Response,
) -> std::io::Result<()> {
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let body = if method == "HEAD" {
        Vec::new()
    } else {
        response.bytes().map(|b| b.to_vec()).unwrap_or_default()
    };
    write_common_headers(stream, status, status_text(status))?;
    for (src, dst) in [
        (reqwest::header::CONTENT_TYPE, "Content-Type"),
        (reqwest::header::CONTENT_LENGTH, "Content-Length"),
        (reqwest::header::CONTENT_RANGE, "Content-Range"),
        (reqwest::header::ACCEPT_RANGES, "Accept-Ranges"),
    ] {
        if let Some(value) = headers.get(src).and_then(|v| v.to_str().ok()) {
            write!(stream, "{dst}: {value}\r\n")?;
        }
    }
    if !headers.contains_key(reqwest::header::CONTENT_LENGTH) {
        write!(stream, "Content-Length: {}\r\n", body.len())?;
    }
    write!(stream, "\r\n")?;
    if method != "HEAD" {
        stream.write_all(&body)?;
    }
    stream.flush()
}
