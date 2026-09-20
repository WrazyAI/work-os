from pathlib import Path
import sys
root=Path(sys.argv[1]); src=root/'desktop/work-os-companion/src'
p=src/'scenarios.ts'; s=p.read_text(); lines=s.splitlines(True)
# Preserve the existing first-launch preset contract; new mascot presets follow existing ones.
new=[line for line in lines if line.startswith('  { id: "mascot_')]
assert len(new)==5
s=''.join(line for line in lines if line not in new)
start=s.index('export const DEBUG_PRESETS:'); end=s.index('\n];',start)
s=s[:end]+'\n'+''.join(new).rstrip('\n')+s[end:]; p.write_text(s)
p=root/'test/work-os-companion-mascot.test.mts';s=p.read_text()
s=s.replace('assert.match(mascotPet, /const visual = deriveMascotVisualState/);','assert.match(mascotPet, /deriveMascotVisualState/);')
p.write_text(s)
p=src/'mascot-runtime.css';p.write_text(p.read_text()+'\n.avatar-orb:has(.mascot-pet[data-reduced-motion="true"]) { animation: none !important; transition: none !important; }\n')
print('Finished compatibility adjustments.')
