type JourneyStageState = 'pending' | 'active' | 'done' | 'failed';
export function createJourneyTracker(stages: NodeListOf<HTMLElement>, viewBadge: HTMLElement) {
  return {
    set(intent: JourneyStageState, result: JourneyStageState, view: JourneyStageState): void {
      const states = [intent, result, view];
      stages.forEach((item, index) => {
        item.dataset.state = states[index] ?? 'pending';
      });
      viewBadge.dataset.state = view === 'done' ? 'ready' : 'pending';
    },
  };
}
