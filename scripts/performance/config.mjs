import { isAbsolute, join } from 'node:path';

export function pairedConfig(base, label) {
  const destination = process.env.AELIQO_PERFORMANCE_PAIR_OUTPUT;
  if (!destination || !isAbsolute(destination)) throw Error('Expected absolute paired performance output path');
  const prefix = 'pnpm build:platform && ';
  if (!base.webServer?.command.startsWith(prefix)) throw Error('Unexpected performance build command');
  return {
    ...base,
    retries: 0,
    outputDir: join(destination, label),
    use: { locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1, ...base.use },
    webServer: { ...base.webServer, command: base.webServer.command.slice(prefix.length) },
  };
}
