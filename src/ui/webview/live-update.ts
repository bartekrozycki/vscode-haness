import type { LiveSession } from '../../contracts/live';

interface LiveState {
    live: LiveSession[];
    liveVersion: number;
    selectedItem: string;
    selectedRun: string;
}
interface LiveUpdate {
    live?: LiveSession[];
    liveVersion?: number;
    selection?: { item?: string; run: string };
}

/** An asynchronous snapshot must not replace a newer stream or its selection. */
export function applyLiveUpdate(state: LiveState, message: LiveUpdate): boolean {
    if (!message.live || (message.liveVersion !== undefined && message.liveVersion < state.liveVersion))
        return false;
    state.liveVersion = message.liveVersion ?? state.liveVersion;
    state.live = message.live;
    if (message.selection) {
        state.selectedRun = message.selection.run;
        state.selectedItem = message.selection.item || state.live.find(s => s.run === state.selectedRun)?.item || state.selectedItem;
    }
    return true;
}
