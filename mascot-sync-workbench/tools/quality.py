from pathlib import Path
import sys
root=Path(sys.argv[1])
p=root/'desktop/work-os-companion/CHANGELOG.md'; text=p.read_text()
start=text.index('## Unreleased - mascot synchronization')
end=text.index('\nAn employee reads',start)
entry=text[start:end].split('\n',1)[1].strip()
text=text[:start]+text[end:]
assert text.count('\n## Unreleased\n')==1
text=text.replace('\n## Unreleased\n', '\n## Unreleased\n\n'+entry+'\n',1)
p.write_text(text)
# Playwright's isDisabled() evaluates actual controls; fieldset.disabled is an
# HTML grouping property. Check the descendant select is genuinely disabled.
for p in [root/'scripts/verify-mascot-sync.cjs', Path(__file__).parent/'browser.cjs']:
 text=p.read_text()
 text=text.replace("assert(await debug.locator('.debug-mascot-controls').isDisabled());", "assert(await debug.getByLabel('Mascot activity', { exact: true }).isDisabled());")
 p.write_text(text)
print('Release bullets placed under existing Unreleased section; disabled select assertion corrected.')
