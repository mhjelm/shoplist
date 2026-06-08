'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  /** Hard stop after this many seconds. */
  maxSeconds: number
  /** Called once with the recorded audio when an intentional stop produces data. */
  onResult: (base64: string, mimeType: string) => void
  /** Called when capture can't proceed (mic denied) or produced no audio. */
  onError: (message: string) => void
}

interface Recorder {
  /** Seconds elapsed in the current recording (drives the countdown UI). */
  elapsed: number
  /** Stop the recording intentionally → triggers onResult with the captured audio. */
  stop: () => void
  /** Reset elapsed and start a fresh recording (retry path). */
  restart: () => void
}

// Recordings shorter than this almost never contain a real spoken item — a
// stray tap of "Done" right after opening the mic. We drop them client-side
// rather than send ~1 s of ambient noise to Gemini, which confabulates a
// plausible-looking list from it ("gurka, mjölk två liter, …") at temperature 0.
const MIN_RECORDING_MS = 1500

// Strip the "data:<mime>;base64," prefix that FileReader produces.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read audio'))
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Encapsulates the getUserMedia + MediaRecorder lifecycle shared by the voice
 * add-item flows: mic acquisition, a max-duration auto-stop timer, the
 * abort-vs-intentional-stop guard, codec-suffix stripping, and base64
 * conversion. Starts recording on mount and releases the mic on unmount.
 *
 * Extracted from SpeechModal so both voice flows (SpeechModal for groceries,
 * TaskSpeechModal for tasks) reuse the subtle parts verbatim.
 */
export function useAudioRecorder({ maxSeconds, onResult, onError }: Options): Recorder {
  const [elapsed, setElapsed] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Wall-clock start of the current recording, for the min-duration guard.
  const startedAtRef = useRef(0)
  // Guards the onstop handler: only deliver audio for an intentional stop, not
  // an abort triggered by unmounting.
  const abortedRef = useRef(false)
  // Keep the latest callbacks without re-running the start effect.
  const onResultRef = useRef(onResult)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onResultRef.current = onResult
    onErrorRef.current = onError
  }, [onResult, onError])

  const releaseMic = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  // Begins the async mic capture. Performs no synchronous setState before the
  // first await: the initial/reset elapsed already matches.
  const startRecording = useCallback(async () => {
    abortedRef.current = false
    chunksRef.current = []

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onErrorRef.current('Mikrofonåtkomst nekades. Tillåt mikrofonen och försök igen.')
      return
    }
    streamRef.current = stream

    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = async () => {
      releaseMic()
      if (abortedRef.current) return
      // Too-short clips are noise, not speech — Gemini hallucinates a list from
      // them. Treat the same as "heard nothing" without the round-trip.
      if (Date.now() - startedAtRef.current < MIN_RECORDING_MS) {
        onErrorRef.current('Hörde inget. Försök igen.')
        return
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      if (blob.size === 0) {
        onErrorRef.current('Hörde inget. Försök igen.')
        return
      }
      try {
        const base64 = await blobToBase64(blob)
        // Gemini accepts base audio MIME types (audio/webm, audio/mp4, …) but
        // NOT the ";codecs=opus" suffix MediaRecorder appends — that returns a
        // 500. Send the bare type.
        const mimeType = blob.type.split(';')[0] || 'audio/webm'
        onResultRef.current(base64, mimeType)
      } catch (e) {
        onErrorRef.current(e instanceof Error ? e.message : 'Kunde inte tolka ljudet')
      }
    }

    recorder.start()
    startedAtRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setElapsed(s => {
        const next = s + 1
        if (next >= maxSeconds && recorderRef.current?.state === 'recording') {
          recorderRef.current.stop()
        }
        return next
      })
    }, 1000)
  }, [maxSeconds, releaseMic])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const restart = useCallback(() => {
    setElapsed(0)
    startRecording()
  }, [startRecording])

  // Start on mount; release the mic on unmount. startRecording's state updates
  // all happen after its first await, so the set-state-in-effect rule can't see
  // past it — false positive here.
  useEffect(() => {
    startRecording()
    return () => {
      abortedRef.current = true
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      releaseMic()
    }
    // Run once on mount — startRecording/releaseMic are stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { elapsed, stop, restart }
}
