import base from './playwright.config.mjs';
import { pairedConfig } from '../../scripts/performance/config.mjs';
export default pairedConfig(base, 'layout');
