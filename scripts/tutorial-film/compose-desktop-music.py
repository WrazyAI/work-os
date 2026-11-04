"""Original tutorial instrumental. No downloaded recording.
Usage: python compose-desktop-music.py OUTPUT.wav SECONDS. Requires numpy.
"""
import sys
import wave
import numpy as np

out = sys.argv[1]
duration = float(sys.argv[2])
rate = 48000
n = int(duration * rate)
track = np.zeros((n, 2), dtype=np.float64)
rng = np.random.default_rng(321)
beat = .6


def add(at, signal, volume=1, pan=0):
    start = int(at * rate)
    if start >= n:
        return
    signal = signal[:n-start] * volume
    balance = np.array([np.cos((pan+1)*np.pi/4), np.sin((pan+1)*np.pi/4)])
    track[start:start+len(signal)] += signal[:, None] * balance


def hz(midi):
    return 440 * 2**((midi-69)/12)


def key(midi, length=1.8):
    t = np.arange(int(length*rate))/rate
    f = hz(midi)
    env = (1-np.exp(-t*100))*np.exp(-t*2.5)
    return (np.sin(2*np.pi*f*t+.7*np.sin(2*np.pi*f*2*t)*np.exp(-t*8))+.18*np.sin(2*np.pi*2*f*t)+.04*np.sin(2*np.pi*3*f*t))*env


def bass(midi, length):
    t = np.arange(int(length*rate))/rate
    env = (1-np.exp(-t*35))*np.exp(-t*1.9)*(1-np.exp(-(length-t)*20))
    return (np.sin(2*np.pi*hz(midi)*t)+.12*np.sin(4*np.pi*hz(midi)*t))*env


chords = [[53,57,60,64], [57,60,64,67], [48,52,55,59], [55,59,62,69]]
for bar in range(int(duration/(4*beat))+1):
    t0 = bar*4*beat
    chord = chords[bar % 4]
    for i, note in enumerate(chord):
        add(t0+i*.042, key(note), .095, -.32+.2*i)
        add(t0+2.5*beat+i*.035, key(note+12, 1.25), .045, .25-.15*i)
    add(t0, bass(chord[0]-12, 1.1), .12, -.05)
    add(t0+2*beat, bass(chord[0]-12, 1.0), .08, .05)
    melody = [[76,72,69,67], [72,76,79,76], [71,67,64,67], [74,71,69,67]][bar % 4]
    for i, note in enumerate(melody):
        add(t0+(i+.5)*beat, key(note, .8), .055, -.22 if i % 2 else .22)
    for b in range(4):
        at = t0+b*beat
        t = np.arange(int(.14*rate))/rate
        kick = np.sin(2*np.pi*(62*t-65*t*t))*np.exp(-t*35)*(1-np.exp(-t*250))
        add(at, kick, .10)
        if b % 2:
            brush = rng.normal(0, 1, len(t))*np.exp(-t*40)*(1-np.exp(-t*200))
            brush = np.convolve(brush, np.ones(6)/6, mode='same')
            add(at, brush, .025, .12)
        for half in [0, .5]:
            t = np.arange(int(.065*rate))/rate
            noise = rng.normal(0, 1, len(t))
            shaker = (noise-np.convolve(noise, np.ones(10)/10, mode='same'))*np.sin(np.pi*t/.065)**2*np.exp(-t*30)
            add(at+half*beat, shaker, .012, -.2 if half else .2)

dry = track.copy()
for delay, gain in [(.11,.12), (.19,.09), (.31,.06)]:
    k = int(delay*rate)
    if k < n:
        track[k:] += dry[:-k, ::-1]*gain
time = np.arange(n)/rate
fade = np.minimum(np.minimum(time/.65, (duration-time)/1.25), 1).clip(0, 1)
track *= fade[:, None]
track = np.tanh(track*1.7)
track *= .30/max(np.max(np.abs(track)), .0001)
with wave.open(out, 'wb') as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(rate)
    f.writeframes((track*32767).astype('<i2').tobytes())
print(f'Original instrumental: {duration:.2f}s, stereo {rate}Hz, 100bpm.')
