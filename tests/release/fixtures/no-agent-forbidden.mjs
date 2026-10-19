import * as forbiddenAgent from '@varendo/agent/browser';

globalThis.__varendoT20Forbidden = {
  module: forbiddenAgent,
  connectAgent: forbiddenAgent.connectAgent,
};
