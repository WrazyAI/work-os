import { useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { RECAP_VOICE_OPTIONS } from "./recapSpeech";

/**
 * How Otto reads to you.
 *
 * Four rows, one per shipped voice, each with its own clip — auditioned here
 * rather than described, because a voice is the one setting that cannot be read
 * about. The employee only ever sees our names for them ("Warm", "Calm"), never
 * the provider's. Selecting is a plain radio: the choice is remembered on the
 * device and the next read uses it.
 */
export function VoicePicker({ value, onChange, disabled = false }: {
  value: string;
  onChange: (voice: string) => void;
  disabled?: boolean;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const toggleSample = (id: string, sample: string) => {
    if (playing === id) {
      audio.current?.pause();
      audio.current = null;
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const element = new Audio(sample);
    audio.current = element;
    setPlaying(id);
    element.addEventListener("ended", () => setPlaying((current) => (current === id ? null : current)));
    void element.play().catch(() => setPlaying(null));
  };

  return <ul className="voice-picker">
    {RECAP_VOICE_OPTIONS.map((option) => {
      const selected = option.id === value;
      const isPlaying = playing === option.id;
      return <li key={option.id} className={`voice-picker-row${selected ? " is-selected" : ""}`} data-voice={option.id}>
        <button
          type="button"
          className="voice-picker-play"
          aria-label={isPlaying ? `Stop the ${option.label} sample` : `Play the ${option.label} sample`}
          title={isPlaying ? "Stop sample" : "Play sample"}
          onClick={() => toggleSample(option.id, option.sample)}
        >{isPlaying ? <Square size={13} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}</button>
        <button
          type="button"
          className="voice-picker-choose"
          aria-pressed={selected}
          disabled={disabled}
          onClick={() => onChange(option.id)}
        >
          <strong>{option.label}</strong>
          <small>{selected ? "Otto reads to you like this" : "Hear it, then choose it"}</small>
        </button>
      </li>;
    })}
  </ul>;
}
