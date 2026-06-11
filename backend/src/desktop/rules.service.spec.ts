import { RulesService } from './rules.service';

/**
 * #23 — guards the exact wire shape of `GET /desktop/rules`. The task title
 * ("fix rules label/shape mismatch") calls out `idleReasons[].label` as the
 * easy thing to get wrong (see the contract comment on `DesktopRulesDto` /
 * `rules.dto.ts`), so these assertions check field *names* explicitly rather
 * than relying on `toMatchObject`/structural equality alone, which would
 * happily pass even if `label` were renamed to `name` as long as some other
 * assertion didn't also fail.
 */
describe('RulesService (#23)', () => {
  const service = new RulesService();

  it('returns work and idle rule values', () => {
    const rules = service.getRules();

    expect(rules.work).toEqual({ targetMinutesPerDay: 480, overtimePromptEnabled: true });
    expect(rules.idle).toEqual({
      idleThresholdSeconds: 300,
      popupTimeoutSeconds: 60,
      autoPauseEnabled: true,
      reasonRequired: true,
    });
  });

  it('uses `code` and `label` (not e.g. `name`/`text`/`description`) on every idle reason', () => {
    const rules = service.getRules();

    expect(rules.idleReasons.length).toBeGreaterThan(0);
    for (const reason of rules.idleReasons) {
      expect(typeof reason.code).toBe('string');
      expect(typeof reason.label).toBe('string');
      expect(reason.code.length).toBeGreaterThan(0);
      expect(reason.label.length).toBeGreaterThan(0);
      // Exactly the two contract fields - nothing extra, nothing renamed.
      expect(Object.keys(reason).sort()).toEqual(['code', 'label']);
    }
  });

  it('matches the mock server demo data exactly, so either backend behaves the same for the client', () => {
    const rules = service.getRules();

    expect(rules.idleReasons).toEqual([
      { code: 'meeting', label: 'Meeting' },
      { code: 'phone', label: 'Phone' },
      { code: 'away', label: 'Away from computer' },
      { code: 'learning', label: 'Learning' },
      { code: 'other', label: 'Other' },
    ]);
  });

  it('returns the same static object shape on every call (no per-request randomness)', () => {
    expect(service.getRules()).toEqual(service.getRules());
  });
});
