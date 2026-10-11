import base from './adverse-visualization.playwright.config.mjs';
import { pairedConfig } from '../../scripts/performance/config.mjs';
export default pairedConfig(base, 'visualization');
