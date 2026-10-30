import type { LiveSession } from '../../contracts/live';
/** Only the selected transcript crosses the webview bridge on each update. */
export function liveForView(sessions: LiveSession[], selectedRun?: string): LiveSession[] {
    const selected = sessions.find(session => session.run === selectedRun) || sessions.find(session => session.controllable) || sessions[0];
    return sessions.map(session => ({ ...session, hasLog: session.entries.length > 0,
        entriesLoaded: session.run === selected?.run, entries: session.run === selected?.run ? session.entries : [] }));
}
