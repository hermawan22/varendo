import type { ToolModelUsage } from './types.js';
import type { ToolModelCostPolicy } from './connection-types.js';

export function withToolModelCost(usage: ToolModelUsage, cost: ToolModelCostPolicy | undefined): ToolModelUsage {
  if (cost === undefined || (cost.inputUSDPerMillion === undefined && cost.outputUSDPerMillion === undefined))
    return usage;
  const inputRate = cost.inputUSDPerMillion ?? 0;
  const outputRate = cost.outputUSDPerMillion ?? 0;
  const estimatedUSD = (usage.inputTokens * inputRate + usage.outputTokens * outputRate) / 1_000_000;
  return {
    ...usage,
    cost: {
      currency: cost.currency ?? 'USD',
      estimatedUSD,
      ...(cost.inputUSDPerMillion === undefined ? {} : { inputUSDPerMillion: cost.inputUSDPerMillion }),
      ...(cost.outputUSDPerMillion === undefined ? {} : { outputUSDPerMillion: cost.outputUSDPerMillion }),
      ...(cost.source === undefined ? {} : { source: cost.source }),
    },
  };
}
