<script>
  // TV safe-area inset card. The pre-paint script in Layout.astro applies
  // the saved value to <html> before first frame; this component owns the
  // settings UI for changing it. setTvOverscan() updates the CSS var in
  // place so the preview is live - no reload required.
  import { onMount } from "svelte"
  import { IconDeviceTv } from "@tabler/icons-svelte"
  import { t, LOCALE_EVENT } from "@/scripts/lib/i18n.js"
  import {
    getTvOverscan,
    setTvOverscan,
    TV_OVERSCAN_EVENT,
  } from "@/scripts/lib/app-settings.js"

  let current = $state(getTvOverscan())
  let locale = $state(0)
  const tr = (key, params) => (locale, t(key, params))

  const OPTIONS = [0, 2, 4, 6, 8]

  function pick(value) {
    setTvOverscan(value)
  }

  onMount(() => {
    const onChange = (event) => {
      const next = event?.detail?.value
      if (typeof next === "number") current = next
      else current = getTvOverscan()
    }
    const onLocale = () => { locale++ }
    document.addEventListener(TV_OVERSCAN_EVENT, onChange)
    document.addEventListener(LOCALE_EVENT, onLocale)
    return () => {
      document.removeEventListener(TV_OVERSCAN_EVENT, onChange)
      document.removeEventListener(LOCALE_EVENT, onLocale)
    }
  })

  function labelFor(value) {
    if (value === 0) return tr("settings.tvOverscan.off")
    return `${value}%`
  }
</script>

<article id="card-tv-overscan" class="icon-mark-host rounded-2xl border border-line bg-surface p-5 sm:p-6 flex flex-col gap-4 scroll-mt-6">
  <div class="flex items-start gap-3">
    <span class="icon-mark">
      <IconDeviceTv aria-hidden="true" stroke={2} />
    </span>
    <div class="flex flex-col gap-1 min-w-0">
      <h3 class="text-base font-semibold">{tr("settings.tvOverscan.title")}</h3>
      <p class="text-xs text-fg-3">{tr("settings.tvOverscan.helperLong")}</p>
    </div>
  </div>
  <div class="flex flex-col gap-2">
    <span class="text-eyebrow font-medium uppercase text-fg-3">{tr("settings.tvOverscan.label")}</span>
    <div
      class="grid grid-cols-3 sm:grid-cols-5 gap-2"
      role="radiogroup"
      aria-label={tr("settings.tvOverscan.label")}>
      {#each OPTIONS as value (value)}
        <button
          type="button"
          class="btn"
          aria-pressed={Math.abs(value - current) < 0.001 ? "true" : "false"}
          onclick={() => pick(value)}>
          {labelFor(value)}
        </button>
      {/each}
    </div>
  </div>
</article>
