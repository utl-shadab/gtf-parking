export const cityDistricts = ["Downtown", "Harbour", "Hills", "Beach"] as const;

export function cityProgress(trialCount: number, trialsCleared: number, finalTrialCleared: boolean, endlessCleared: number) {
  const unlocked = finalTrialCleared ? Math.min(cityDistricts.length, 1 + Math.floor(endlessCleared / 10)) : 0;
  return {
    unlocked,
    target: unlocked === 0 ? trialCount : 10,
    completed: unlocked === 0 ? trialsCleared : endlessCleared % 10,
  };
}
