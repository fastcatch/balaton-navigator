/**
 * Settings (spec 6.4): units, arrival radius, minimum accuracy, wake lock.
 *
 * Deliberately short. The spec asks for no elaborate settings menu, so this
 * exposes only values that change behaviour a sailor would notice.
 */

import { el } from './dom.js';

const numberField = (label, hint, value, min, max, onCommit) => {
  const input = el('input', {
    type: 'number',
    inputMode: 'numeric',
    value: String(value),
    min: String(min),
    max: String(max),
    onChange: (e) => {
      const parsed = Number(e.target.value);
      // Clamp rather than reject: an out-of-range radius should not leave the
      // app in a state where arrival never triggers.
      const clamped = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value;
      e.target.value = String(clamped);
      onCommit(clamped);
    },
  });

  return el('div', { className: 'field' }, [
    el('label', { textContent: label }),
    input,
    el('div', { className: 'hint', textContent: hint }),
  ]);
};

export function renderSettings({ settings, onChange }) {
  const update = (patch) => onChange({ ...settings, ...patch });

  const units = el('select', {
    onChange: (e) => update({ units: e.target.value }),
  }, [
    el('option', { value: 'metric', textContent: 'Méter / kilométer', selected: settings.units === 'metric' }),
    el('option', { value: 'nautical', textContent: 'Tengeri mérföld (NM)', selected: settings.units === 'nautical' }),
  ]);

  const keepAwake = el('select', {
    onChange: (e) => update({ keepAwake: e.target.value === 'yes' }),
  }, [
    el('option', { value: 'yes', textContent: 'Igen', selected: settings.keepAwake }),
    el('option', { value: 'no', textContent: 'Nem', selected: !settings.keepAwake }),
  ]);

  return [
    el('div', { className: 'field' }, [el('label', { textContent: 'Mértékegység' }), units]),

    numberField(
      'Waypoint elérve sugár (m)',
      'Ennél közelebb érve az app automatikusan a következő waypointra vált.',
      settings.arrivalRadiusM, 5, 1000,
      (v) => update({ arrivalRadiusM: v })
    ),

    numberField(
      'Track rögzítés max. pontatlanság (m)',
      'Ennél pontatlanabb GPS-pontok nem kerülnek be a rögzített útvonalba.',
      settings.minAccuracyM, 5, 500,
      (v) => update({ minAccuracyM: v })
    ),

    el('div', { className: 'field' }, [
      el('label', { textContent: 'Képernyő ébren tartása rögzítés közben' }),
      keepAwake,
      el('div', {
        className: 'hint',
        textContent: 'Az iOS felfüggeszti az appot, ha a képernyő lezár – ilyenkor a rögzítés megszakad.',
      }),
    ]),

    el('div', { className: 'note' }, [
      el('strong', { textContent: 'Rögzítésről: ' }),
      document.createTextNode(
        'iPhone-on a böngésző-alapú appok nem tudnak háttérben GPS-t rögzíteni. ' +
          'Hosszabb túrán hagyd a képernyőt bekapcsolva és a telefont töltőn. ' +
          'A megszakadt szakaszokat az app külön vonalként rajzolja ki, nem köti össze őket.'
      ),
    ]),
  ];
}
