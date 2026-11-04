import { writeFileSync } from 'node:fs';
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO, insightsFixture } from '../../desktop/work-os-companion/src/scenarios.ts';
const scenario={...DEFAULT_DEBUG_SCENARIO,enabled:true,dayState:'clocked_in' as const,onboardingState:'complete' as const};
const day=applyDayScenario(null,scenario);
if(!day)throw new Error('The film scenario must produce a day fixture');
writeFileSync(process.argv[2],JSON.stringify({day,onboarding:applyOnboardingScenario(null,scenario),insights:insightsFixture(day,'7d')}));
