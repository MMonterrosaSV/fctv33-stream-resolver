const elements = {
  form: document.getElementById('resolve-form'),
  streamPageUrl: document.getElementById('stream-page-url'),
  submitButton: document.querySelector('#resolve-form button'),
  resultsPanel: document.getElementById('results-panel'),
  streamTitle: document.getElementById('stream-title'),
  videoElement: document.getElementById('video-element'),
  errorMessage: document.getElementById('error-message'),
  exports: {
    directUrl: document.getElementById('export-direct-url'),
    proxiedUrl: document.getElementById('export-proxied-url'),
    vlcUrl: document.getElementById('export-vlc-url'),
    mpvUrl: document.getElementById('export-mpv-url'),
  },
  timing: {
    panel: document.getElementById('timing-panel'),
    resolve: document.getElementById('timing-resolve'),
    play: document.getElementById('timing-play'),
  },
}

const playbackState = { hlsPlayer: null, generation: 0, timer: null }

const formatMilliseconds = (milliseconds) =>
  milliseconds < 1000 ? `${Math.round(milliseconds)}ms` : `${(milliseconds / 1000).toFixed(2)}s`

const showError = (message) => {
  elements.errorMessage.textContent = message
  elements.errorMessage.hidden = false
}

const stopTiming = () => {
  if (!playbackState.timer) return
  cancelAnimationFrame(playbackState.timer.animationFrame)
  playbackState.timer = null
}

const startTiming = () => {
  stopTiming()
  const { panel, resolve, play } = elements.timing
  panel.hidden = false
  resolve.textContent = '0ms'
  play.textContent = 'waiting'
  resolve.className = 'timing__val is-live'
  play.className = 'timing__val'
  const startedAt = performance.now()
  let resolvedAt = null
  let playedAt = null
  const tick = () => {
    const now = performance.now()
    if (resolvedAt == null) resolve.textContent = formatMilliseconds(now - startedAt)
    if (resolvedAt != null && playedAt == null) {
      play.textContent = formatMilliseconds(now - resolvedAt)
      play.className = 'timing__val is-live'
    }
    if (playedAt == null) playbackState.timer.animationFrame = requestAnimationFrame(tick)
  }
  playbackState.timer = {
    animationFrame: requestAnimationFrame(tick),
    markResolved() {
      if (resolvedAt != null) return
      resolvedAt = performance.now()
      resolve.textContent = formatMilliseconds(resolvedAt - startedAt)
      resolve.className = 'timing__val is-done'
      play.textContent = '0ms'
      play.className = 'timing__val is-live'
    },
    markPlayed() {
      if (playedAt != null) return
      playedAt = performance.now()
      if (resolvedAt == null) this.markResolved()
      play.textContent = formatMilliseconds(playedAt - resolvedAt)
      play.className = 'timing__val is-done'
      stopTiming()
    },
  }
  return playbackState.timer
}

const stopPlayback = () => {
  playbackState.generation += 1
  if (playbackState.hlsPlayer) {
    playbackState.hlsPlayer.destroy()
    playbackState.hlsPlayer = null
  }
  elements.videoElement.pause()
  elements.videoElement.removeAttribute('src')
  elements.videoElement.load()
}

const startPlayback = (playableUrl, timing) => {
  stopPlayback()
  const generation = playbackState.generation
  const isCurrent = () => generation === playbackState.generation
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (success, error) => {
      if (!isCurrent() || finished) return
      finished = true
      elements.videoElement.removeEventListener('playing', onPlaying)
      elements.videoElement.removeEventListener('error', onError)
      success ? (elements.errorMessage.hidden = true, timing?.markPlayed(), resolve()) : reject(error)
    }
    const onPlaying = () => finish(true)
    const onError = () => finish(false, new Error('playback failed'))
    elements.videoElement.addEventListener('playing', onPlaying)
    elements.videoElement.addEventListener('error', onError)
    if (Hls.isSupported()) {
      let started = false
      const liveSyncSegments = 3
      playbackState.hlsPlayer = new Hls({
        enableWorker: false,
        liveDurationInfinity: true,
        startPosition: -1,
        liveSyncDurationCount: liveSyncSegments,
        liveMaxLatencyDurationCount: liveSyncSegments + 3,
        maxLiveSyncPlaybackRate: 1.2,
        maxBufferLength: 30,
        backBufferLength: 0,
        fragLoadingTimeOut: 25000,
        manifestLoadingTimeOut: 20000,
      })
      playbackState.hlsPlayer.on(Hls.Events.ERROR, (_, data) =>
        data.fatal && finish(false, new Error(data.details || 'playback failed')),
      )
      const startWhenLiveReady = () => {
        if (!isCurrent() || started) return
        const hls = playbackState.hlsPlayer
        const video = elements.videoElement
        const syncPos = hls?.liveSyncPosition
        if (syncPos == null) return
        const buffered = video.buffered
        if (!buffered.length) return
        const segmentDuration = hls.levels?.[hls.currentLevel]?.details?.targetduration ?? 3
        const bufferEnd = buffered.end(buffered.length - 1)
        if (bufferEnd < syncPos + segmentDuration * liveSyncSegments) return
        if (Math.abs(video.currentTime - syncPos) > 0.25) video.currentTime = syncPos
        started = true
        video.play().catch(() => {})
      }
      playbackState.hlsPlayer.on(Hls.Events.FRAG_BUFFERED, startWhenLiveReady)
      playbackState.hlsPlayer.on(Hls.Events.LEVEL_UPDATED, startWhenLiveReady)
      playbackState.hlsPlayer.attachMedia(elements.videoElement)
      playbackState.hlsPlayer.loadSource(playableUrl)
      return
    }
    if (elements.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      elements.videoElement.src = playableUrl
      elements.videoElement.addEventListener(
        'canplay',
        () => isCurrent() && elements.videoElement.play().catch(() => {}),
        { once: true },
      )
      return
    }
    finish(false, new Error('HLS not supported'))
  })
}

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

const bindExportFields = (result) => {
  const { directUrl, proxiedUrl, vlcUrl, mpvUrl } = elements.exports
  const streamUrl = result.streamUrl ?? ''
  const referer = result.referer ?? ''
  const playableUrl = result.playableUrl ?? ''
  directUrl.value = streamUrl
  proxiedUrl.value = playableUrl
  vlcUrl.value =
    streamUrl && referer ? `vlc --http-referrer ${shellQuote(referer)} ${shellQuote(streamUrl)}` : ''
  mpvUrl.value =
    streamUrl && referer ? `mpv --referrer=${shellQuote(referer)} ${shellQuote(streamUrl)}` : ''
}

const resolveStream = async () => {
  const streamPageUrl = elements.streamPageUrl.value.trim()
  if (!streamPageUrl) return showError('Paste the stream page URL from your browser address bar')
  elements.submitButton.disabled = true
  elements.errorMessage.hidden = true
  elements.resultsPanel.hidden = true
  stopPlayback()
  stopTiming()
  elements.timing.panel.hidden = true
  const timing = startTiming()
  try {
    const response = await fetch(`/api/resolve-link?url=${encodeURIComponent(streamPageUrl)}`)
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`)
    elements.streamTitle.textContent = result.name || 'Stream'
    elements.resultsPanel.hidden = false
    bindExportFields(result)
    timing.markResolved()
    if (result.playableUrl) await startPlayback(result.playableUrl, timing)
  } catch (error) {
    stopTiming()
    elements.timing.panel.hidden = true
    showError(error instanceof Error ? error.message : 'Resolve failed')
  } finally {
    elements.submitButton.disabled = false
  }
}

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const field = document.getElementById(button.dataset.copy)
    if (!field?.value) return
    await navigator.clipboard.writeText(field.value)
    const label = button.textContent
    button.textContent = 'Copied'
    button.classList.add('ok')
    setTimeout(() => {
      button.textContent = label
      button.classList.remove('ok')
    }, 1200)
  })
})

elements.form.addEventListener('submit', (event) => {
  event.preventDefault()
  resolveStream()
})

const queryStreamPageUrl = new URLSearchParams(location.search).get('url')?.trim()
if (queryStreamPageUrl) {
  elements.streamPageUrl.value = queryStreamPageUrl
  resolveStream()
}
