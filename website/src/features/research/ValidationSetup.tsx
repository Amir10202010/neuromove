// New validation session: participant (pseudonymous code) + protocol version + device + notes.
// The session record is created immediately (status 'active'), so a reload never loses it.

import { Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { href, navigate } from '../../app/router';
import type { DeviceKind } from '../../devices/types';
import { PageHeader } from '../../layout/PageHeader';
import { capabilityOf, requiredForValidation } from '../../research/capabilities';
import { latestVersions } from '../../research/protocols';
import { useResearchStore } from '../../research/store';
import { currentClinician, useWorkspaceData } from '../../state/appStore';
import { Button, LinkButton } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { useRT } from './i18n';

export function ValidationSetup({ protocolKey }: { protocolKey: string | null }) {
  const rt = useRT();
  const { ws, patients } = useWorkspaceData();
  const loaded = useResearchStore((s) => s.loaded);
  const load = useResearchStore((s) => s.load);
  const all = useResearchStore((s) => s.protocols);
  const create = useResearchStore((s) => s.createSession);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  const protocols = useMemo(() => latestVersions(all.filter((v) => v.workspace === ws)), [all, ws]);
  const [pKey, setPKey] = useState<string>(protocolKey ?? '');
  const [participant, setParticipant] = useState('');
  // Clinic: only real devices. Demo: the simulator (labelled simulated everywhere).
  const kinds: DeviceKind[] = ws === 'demo' ? ['simulator'] : ['usb', 'ble'];
  const [kind, setKind] = useState<DeviceKind>(kinds[0] as DeviceKind);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = protocols.find((v) => v.key === pKey) ?? protocols[0];
  const active = patients.filter((p) => p.status !== 'discharged');

  if (loaded && protocols.length === 0)
    return (
      <div className="page page--narrow">
        <PageHeader back={{ href: href({ name: 'research' }), label: rt('Research') }} title={rt('New validation session')} />
        <div className="card">
          <EmptyState title={rt('Create a protocol first')} action={<LinkButton variant="primary" href={href({ name: 'researchProtocols' })}>{rt('Protocols')}</LinkButton>} />
        </div>
      </div>
    );

  const start = async () => {
    if (!chosen || !participant) return;
    setBusy(true);
    setError(null);
    try {
      const s = await create({
        workspace: ws,
        participantId: participant,
        operator: currentClinician(),
        protocol: chosen,
        device: { kind, name: kind, firmware: '–', format: 'imu-csv v1', rateHz: 100, simulated: kind === 'simulator', sensors: [] },
        notes: notes.trim(),
      });
      navigate({ name: 'researchSession', id: s.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const d = chosen?.definition;
  return (
    <div className="page page--narrow">
      <PageHeader back={{ href: href({ name: 'research' }), label: rt('Research') }} title={rt('New validation session')} lead={rt('Every repetition pauses for a goniometer reading. Each value is saved on this device before the next repetition.')} />
      <section className="card card__body stack">
        <label className="field">
          <span className="field__label">{rt('Participant (pseudonymous code)')}</span>
          <select className="select" value={participant} onChange={(e) => setParticipant(e.target.value)}>
            <option value="">{rt('Choose…')}</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
          <span className="field__hint">
            {rt('Use codes, not names.')} <a href={href({ name: 'patients' })}>{rt('Add a participant')}</a>
          </span>
        </label>
        <label className="field">
          <span className="field__label">{rt('Protocol')}</span>
          <select className="select" value={chosen?.key ?? ''} onChange={(e) => setPKey(e.target.value)}>
            {protocols.map((v) => (
              <option key={v.key} value={v.key}>
                {v.definition.name} · v{v.version}
              </option>
            ))}
          </select>
        </label>
        {d && (
          <div className="callout callout--info">
            <div>
              <div className="callout__title">
                {d.joint} · {d.movementType} · {rt(d.side === 'left' ? 'Left' : 'Right')}
              </div>
              <div>
                {d.sets} × {d.repetitions} × {d.measurementPoints.map((p) => p.label).join(' / ')} · {rt(d.captureMode === 'hold' ? 'hold capture' : 'repetition-peak capture')}
              </div>
              <div className="small">
                {rt('Sensors needed')}: {requiredForValidation(d.exercise, d.side).join(', ')} · {rt(capabilityOf(d.exercise).status === 'operational' ? 'Operational' : 'Experimental')}
              </div>
              {d.operatorNotes && <div className="small muted">{d.operatorNotes}</div>}
            </div>
          </div>
        )}
        <label className="field">
          <span className="field__label">{rt('Connection')}</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k === 'usb' ? 'USB (Web Serial)' : k === 'ble' ? 'Bluetooth' : rt('Simulator (demo only)')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{rt('Measurement conditions / notes')}</span>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={rt('Goniometer model, positioning, room, anything unusual')} />
        </label>
        {error && <div className="callout callout--critical">{error}</div>}
        <Button variant="primary" size="lg" icon={<Play />} disabled={!participant || !chosen || busy} loading={busy} onClick={() => void start()}>
          {rt('Create session and connect sensors')}
        </Button>
        {active.length === 0 && <EmptyState compact title={rt('No participants in this workspace')} action={<LinkButton href={href({ name: 'patients' })}>{rt('Add a participant')}</LinkButton>} />}
      </section>
    </div>
  );
}
