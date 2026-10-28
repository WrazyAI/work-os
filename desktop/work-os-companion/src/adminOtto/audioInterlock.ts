/** The local half of the one-audio-owner rule: starting the microphone stops a
 * read, and starting a read cancels the microphone. The surface owns both
 * controls; the cross-window broker owns the other half. */
export type AdminAudioInterlock = {
  microphoneStarted: () => void;
  speechStarted: () => void;
};

export function createAdminAudioInterlock(deps: {
  stopSpeech: () => void;
  stopMicrophone: () => void;
}): AdminAudioInterlock {
  return {
    microphoneStarted() {
      deps.stopSpeech();
    },
    speechStarted() {
      deps.stopMicrophone();
    },
  };
}
