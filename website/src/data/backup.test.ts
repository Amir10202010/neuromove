import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { generateDemoWorkspace } from './seed/demo';
import { checkStoredRecords, parseWorkspaceBackup, previewBackup } from './backup';
import { createMemoryStorage } from './db';

describe('archive integrity and simulation provenance', async () => {
  const data = await generateDemoWorkspace({ now: new Date('2026-09-27T12:00:00Z'), t: makeT('en'), clinician:'Test operator' });
  const archive = () => JSON.parse(JSON.stringify({ format:'neuromove-backup',version:1,workspace:'demo',data }));
  it('round-trips a complete generated workspace and clears unavailable raw flags', () => {
    const a = archive(); a.data.sessions[0].hasRaw = true;
    const parsed = parseWorkspaceBackup(JSON.stringify(a),'demo');
    expect(parsed?.patients).toHaveLength(data.patients.length);
    expect(parsed?.sessions).toHaveLength(data.sessions.length);
    expect(parsed?.sessions.every(s => !s.hasRaw && s.demo)).toBe(true);
  });
  it('rejects cross-workspace archives', () => expect(parseWorkspaceBackup(JSON.stringify(archive()),'clinic')).toBeNull());
  it('rejects a relabeled simulation in the local workspace', () => {
    const a=archive();a.workspace='clinic';
    for(const collection of ['patients','sessions','notes','alerts']) for(const row of a.data[collection]) row.workspace='clinic';
    expect(parseWorkspaceBackup(JSON.stringify(a),'clinic')).toBeNull();
  });
  it('rejects corrupt chart arrays before importing', () => {
    const a=archive();a.data.sessions[0].steps[0].trace.angle=[];
    expect(parseWorkspaceBackup(JSON.stringify(a),'demo')).toBeNull();
  });
  it('rejects duplicate IDs and orphaned records', () => {
    const a=archive();a.data.patients.push(a.data.patients[0]);
    expect(parseWorkspaceBackup(JSON.stringify(a),'demo')).toBeNull();
    const b=archive();b.data.sessions[0].patientId='missing';
    expect(parseWorkspaceBackup(JSON.stringify(b),'demo')).toBeNull();
  });
  it('rejects formula-like or overlong text from a foreign archive', () => {
    const a=archive();a.data.patients[0].code='=1+1';
    expect(parseWorkspaceBackup(JSON.stringify(a),'demo')).toBeNull();
    const b=archive();b.data.patients[0].code='А'.repeat(41);
    expect(parseWorkspaceBackup(JSON.stringify(b),'demo')).toBeNull();
    const c=archive();c.data.sessions[0].note='x'.repeat(20_001);
    expect(parseWorkspaceBackup(JSON.stringify(c),'demo')).toBeNull();
  });
  it('accepts a child name and an old code like P07', () => {
    const a=archive();a.data.patients[0].code='Алихан С.';
    expect(parseWorkspaceBackup(JSON.stringify(a),'demo')?.patients[0]?.code).toBe('Алихан С.');
    const b=archive();b.data.patients[0].code='P07';
    expect(parseWorkspaceBackup(JSON.stringify(b),'demo')?.patients[0]?.code).toBe('P07');
  });
  it('keeps sane accelerometer corrections and rejects broken ones', () => {
    const a=archive();a.data.sessions[0].device.accCal={fore_r:{off:[12,-30,45],scale:[1.0012,0.9988,1.0005]}};
    expect(parseWorkspaceBackup(JSON.stringify(a),'demo')?.sessions[0]?.device.accCal?.fore_r?.off).toEqual([12,-30,45]);
    const b=archive();b.data.sessions[0].device.accCal={fore_r:{off:[12,-30,45],scale:[0,1,1]}};
    expect(parseWorkspaceBackup(JSON.stringify(b),'demo')).toBeNull();
    const c=archive();c.data.sessions[0].device.accCal={elbow:{off:[0,0,0],scale:[1,1,1]}};
    expect(parseWorkspaceBackup(JSON.stringify(c),'demo')).toBeNull();
  });
  it('keeps module fingerprints and rejects garbage in their place', () => {
    const a=archive();a.data.sessions[0].device.moduleIds={fore_r:'5A4C6333',trunk:'none'};
    expect(parseWorkspaceBackup(JSON.stringify(a),'demo')?.sessions[0]?.device.moduleIds).toEqual({fore_r:'5A4C6333',trunk:'none'});
    const b=archive();b.data.sessions[0].device.moduleIds={fore_r:'=HYPERLINK("x")'};
    expect(parseWorkspaceBackup(JSON.stringify(b),'demo')).toBeNull();
    const c=archive();c.data.sessions[0].device.moduleIds={elbow:'5A4C6333'};
    expect(parseWorkspaceBackup(JSON.stringify(c),'demo')).toBeNull();
  });
  it('preview counts what the backup holds before anything is replaced; a broken backup gives no preview', () => {
    const p = previewBackup(JSON.stringify(archive()),'demo');
    expect(p?.patients).toBe(data.patients.length);
    expect(p?.sessions).toBe(data.sessions.length);
    const starts = data.sessions.map(s => s.startedAt).sort();
    expect(p?.from).toBe(starts[0]);
    expect(p?.to).toBe(starts.at(-1));
    const broken = archive(); broken.data.sessions[0].steps = 'x';
    expect(previewBackup(JSON.stringify(broken),'demo')).toBeNull();
    expect(previewBackup(JSON.stringify(archive()),'clinic')).toBeNull();
  });
  it('rejects unsupported versions and malformed JSON', () => {
    const a=archive();a.version=20;
    expect(parseWorkspaceBackup(JSON.stringify(a),'demo')).toBeNull();
    expect(parseWorkspaceBackup('{','demo')).toBeNull();
    expect(parseWorkspaceBackup('{"format":"neuromove-backup","data":{"patients":[]}}','demo')).toBeNull();
  });
  it('removes raw data when a memory workspace is replaced', async () => {
    const storage=createMemoryStorage();
    await storage.replaceWorkspace('demo',data);
    const id=data.sessions[0]!.id;
    await storage.putRaw(id,[{seq:0,t:0,data:{}}]);
    await storage.replaceWorkspace('demo',{patients:[],sessions:[],notes:[],alerts:[]});
    expect(await storage.getRaw(id)).toBeNull();
  });
});

describe('simulated data never enters the clinic workspace', async () => {
  const { useAppStore } = await import('../state/appStore');
  const data = await generateDemoWorkspace({ now: new Date('2026-09-27T12:00:00Z'), t: makeT('en'), clinician: 'Test operator' });
  it('refuses to save a simulated session into the clinic workspace', () => {
    const demo = data.sessions[0]!;
    const before = useAppStore.getState().sessions.length;
    useAppStore.getState().saveSession({ ...demo, id: 'x-clinic', workspace: 'clinic', demo: false, device: { ...demo.device, kind: 'replay', simulated: true } });
    expect(useAppStore.getState().sessions.length).toBe(before);
    expect(useAppStore.getState().toasts.at(-1)?.kind).toBe('critical');
  });
});

describe('один сеанс сохраняется один раз', async () => {
  const { useAppStore } = await import('../state/appStore');
  const data = await generateDemoWorkspace({ now: new Date('2026-09-27T12:00:00Z'), t: makeT('en'), clinician: 'Test operator' });
  it('второй saveSession с тем же id не задваивает сеанс, оповещения и не сдвигает следующий визит', () => {
    const session = data.sessions.at(-1)!;
    const patient = { ...data.patients.find((p) => p.id === session.patientId)!, nextVisit: session.startedAt };
    useAppStore.setState({ patients: [patient], sessions: [], alerts: [], notes: [] });
    const first = useAppStore.getState().saveSession({ ...session, workspace: 'demo' });
    const after1 = useAppStore.getState();
    const visit1 = after1.patients[0]!.nextVisit;
    const second = useAppStore.getState().saveSession({ ...session, workspace: 'demo' });
    const after2 = useAppStore.getState();
    expect(second).toBe(first);
    expect(after2.sessions).toHaveLength(1);
    expect(after2.alerts).toHaveLength(after1.alerts.length);
    expect(after2.patients[0]!.nextVisit).toBe(visit1);
  });
});

describe('записи из хранилища браузера', async () => {
  const data = await generateDemoWorkspace({ now: new Date('2026-09-27T12:00:00Z'), t: makeT('en'), clinician: 'Test operator' });
  it('сеанс, завершённый досрочно (NaN у пропущенных шагов), не теряется после перезагрузки', () => {
    const s = structuredClone(data.sessions[0]!);
    s.steps[1]!.summary.rom = NaN;
    s.steps[1]!.summary.sparc = NaN;
    s.quality.percent = NaN;
    const r = checkStoredRecords({ patients: data.patients, sessions: [s], notes: [], alerts: [] });
    expect(r.rejected).toBe(0);
    expect(r.data.sessions[0]?.steps[1]?.summary.rom).toBeNaN();
  });
  it('испорченная запись и смоделированный сеанс в клинике — скрыты и посчитаны', () => {
    const broken = { id: 'b1', workspace: 'clinic', patientId: 'p' } as never;
    const sim = { ...structuredClone(data.sessions[0]!), id: 's-clinic', workspace: 'clinic' as const };
    const r = checkStoredRecords({ patients: data.patients, sessions: [broken, sim, data.sessions[1]!], notes: [], alerts: [] });
    expect(r.rejected).toBe(2);
    expect(r.data.sessions.map((x) => x.id)).toEqual([data.sessions[1]!.id]);
  });
});
