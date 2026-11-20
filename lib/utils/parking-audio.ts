const sounds = {
  enter: ["enter.mp3", 0.42],
  start: ["start.wav", 1.05],
  engine: ["engine.wav", 0.2],
  ambience: ["ambience.mp3", 1.1],
  brake: ["brake.mp3", 0.54],
  crash: ["crash.mp3", 0.92],
  shift: ["shift.mp3", 0.42],
  success: ["success.mp3", 0.56],
} as const;

type Cue = keyof typeof sounds;
type Loop = "engine" | "ambience";
const loops = ["engine", "ambience"] as const;

interface MediaChannel {
  element: HTMLAudioElement;
  primed: boolean;
  priming: boolean;
  pending: boolean;
}

class NativePlayback {
  private channels = new Map<Cue, MediaChannel>();

  constructor(private report: (ready: boolean) => void) {}

  private channel(cue: Cue) {
    const existing = this.channels.get(cue);
    if (existing) return existing;
    const element = new Audio("/audio/unlock.wav");
    element.preload = "auto";
    const channel = { element, primed: false, priming: false, pending: false };
    this.channels.set(cue, channel);
    return channel;
  }

  unlock(sample = false) {
    for (const cue of Object.keys(sounds) as Cue[]) {
      const channel = this.channel(cue);
      if (sample && cue === "enter") {
        if (!channel.primed) {
          channel.element.src = `/audio/${sounds.enter[0]}`;
          channel.primed = true;
        }
        this.play(cue);
        continue;
      }
      if (channel.primed && channel.pending) this.play(cue);
      if (channel.primed || channel.priming) continue;
      channel.priming = true;
      const { element } = channel;
      // iOS grants playback per element. Prime each channel with an inaudible clip on the tap.
      void element.play().then(() => {
        if (this.channels.get(cue) !== channel || channel.primed) return;
        element.pause();
        element.src = `/audio/${cue === "engine" ? "engine-mobile.mp3" : sounds[cue][0]}`;
        element.loop = loops.some((loop) => loop === cue);
        element.preservesPitch = cue !== "engine";
        channel.primed = true;
        if (channel.pending) this.play(cue);
      }).catch(() => { if (!channel.primed) this.report(false); }).finally(() => { channel.priming = false; });
    }
  }

  play(cue: Cue) {
    const channel = this.channel(cue);
    if (!channel.primed) {
      channel.pending = true;
      return;
    }
    channel.pending = false;
    channel.element.currentTime = 0;
    void channel.element.play().then(() => this.report(true)).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        channel.pending = error instanceof DOMException && error.name === "NotAllowedError";
        this.report(false);
      }
    });
  }

  tune(rate: number) {
    const engine = this.channels.get("engine");
    if (engine?.primed) engine.element.playbackRate = rate;
  }

  stop(cue: Cue) {
    const channel = this.channels.get(cue);
    if (!channel) return;
    channel.pending = false;
    if (channel.primed) channel.element.pause();
  }

  reset() {
    for (const cue of this.channels.keys()) this.stop(cue);
  }

  dispose() {
    for (const { element } of this.channels.values()) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.channels.clear();
  }
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class ParkingAudio {
  private media?: NativePlayback;
  private context?: AudioContext;
  private mix?: DynamicsCompressorNode;
  private buffers = new Map<Cue, Promise<AudioBuffer>>();
  private voices = new Map<AudioBufferSourceNode, GainNode>();
  private loops = new Map<Loop, Voice>();
  private enabled = true;
  private ignited = false;
  private running = false;
  private braking = false;
  private revision = 0;
  private loopRevision = 0;
  private speed = 0;
  private throttle = false;
  private audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;

  constructor(private onReady: (ready: boolean) => void) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios || typeof AudioContext === "undefined") {
      this.media = new NativePlayback((ready) => this.onReady(this.enabled && ready));
    }
  }

  private setSession(type: "auto" | "playback") {
    if (!this.media || !this.audioSession) return;
    try { this.audioSession.type = type; } catch { /* Playback also works without the optional session override. */ }
  }

  unlock(confirmedTap = false) {
    if (!this.enabled) return;
    if (this.media) {
      if (confirmedTap) {
        this.setSession("playback");
        this.media.unlock();
      }
      return;
    }
    if (!this.context) {
      const context = new AudioContext();
      const mix = context.createDynamicsCompressor();
      mix.threshold.value = -5;
      mix.ratio.value = 5;
      mix.connect(context.destination);
      this.context = context;
      this.mix = mix;
      context.onstatechange = () => this.onReady(this.enabled && context.state === "running");
      for (const cue of Object.keys(sounds) as Cue[]) void this.load(context, cue).catch(() => {});
    }
    if (this.context.state !== "running") void this.context.resume().catch(() => {});
    else this.onReady(true);
  }

  testSound() {
    if (!this.enabled) return;
    if (this.media) {
      this.setSession("playback");
      this.media.unlock(true);
    } else {
      this.unlock(true);
      this.cue("enter");
    }
  }

  private load(context: AudioContext, cue: Cue) {
    const existing = this.buffers.get(cue);
    if (existing) return existing;
    const request = fetch(`/audio/${sounds[cue][0]}`).then((response) => {
      if (!response.ok) throw new Error(`Audio unavailable: ${cue}`);
      return response.arrayBuffer();
    }).then((data) => context.decodeAudioData(data)).catch((error: unknown) => {
      this.buffers.delete(cue);
      throw error;
    });
    this.buffers.set(cue, request);
    return request;
  }

  private updateEngine(voice: Voice) {
    const speed = Math.min(Math.abs(this.speed) / 5.35, 1);
    const time = voice.source.context.currentTime;
    voice.source.playbackRate.setTargetAtTime(0.76 + speed * 0.72 + (this.throttle ? 0.14 : 0), time, 0.06);
    voice.gain.gain.setTargetAtTime(0.19 + speed * 0.16 + (this.throttle ? 0.11 : 0), time, 0.06);
  }

  private play(cue: Cue, loop?: Loop) {
    const { context, mix, revision, loopRevision } = this;
    if (!this.enabled) return;
    if (this.media) {
      this.media.play(cue);
      return;
    }
    if (!context || !mix) return;
    void this.load(context, cue).then((buffer) => {
      if (this.revision !== revision || (loop && this.loopRevision !== loopRevision)) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = Boolean(loop);
      gain.gain.value = sounds[cue][1];
      source.connect(gain);
      gain.connect(mix);
      const voice = { source, gain };
      this.voices.set(source, gain);
      if (loop) this.loops.set(loop, voice);
      if (cue === "engine") this.updateEngine(voice);
      source.onended = () => {
        if (loop && this.loops.get(loop) === voice) this.loops.delete(loop);
        this.disconnect(source, gain);
      };
      source.start();
    }).catch(() => {});
  }

  private disconnect(source: AudioBufferSourceNode, gain: GainNode) {
    source.disconnect();
    gain.disconnect();
    this.voices.delete(source);
  }

  cue(cue: Exclude<Cue, Loop>) {
    this.play(cue);
  }

  begin() {
    this.unlock();
    if (this.ignited || !this.enabled) return;
    this.ignited = true;
    this.cue("enter");
    this.cue("start");
    this.sync(0, true, true);
  }

  sync(speed: number, throttle: boolean, active: boolean) {
    if (!this.ignited || !this.enabled || !active) {
      this.suspend();
      return;
    }
    this.speed = speed;
    this.throttle = throttle;
    if (!this.running) {
      this.running = true;
      this.play("engine", "engine");
      this.play("ambience", "ambience");
    }
    const engine = this.loops.get("engine");
    if (engine) this.updateEngine(engine);
    this.media?.tune(0.76 + Math.min(Math.abs(speed) / 5.35, 1) * 0.72 + (throttle ? 0.14 : 0));
  }

  brake(pressed: boolean, speed: number) {
    if (pressed && !this.braking && this.ignited && Math.abs(speed) > 1.2) this.cue("brake");
    this.braking = pressed;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.setSession("auto");
      this.onReady(false);
      this.reset();
    }
  }

  suspend() {
    if (!this.running) return;
    this.running = false;
    this.braking = false;
    this.loopRevision++;
    for (const cue of loops) this.media?.stop(cue);
    for (const { source, gain } of this.loops.values()) {
      source.stop();
      this.disconnect(source, gain);
    }
    this.loops.clear();
  }

  reset() {
    this.ignited = false;
    this.revision++;
    this.suspend();
    this.media?.reset();
    for (const [source, gain] of this.voices) {
      source.stop();
      this.disconnect(source, gain);
    }
  }

  dispose() {
    this.reset();
    this.buffers.clear();
    this.media?.dispose();
    this.setSession("auto");
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
  }
}
