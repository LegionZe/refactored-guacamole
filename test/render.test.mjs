// Node smoke test: builds a PDF from a mock actor shaped like the shadowrun5e v0.37 data model.
// Run: node test/render.test.mjs [output.pdf]
import { writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { collectCharacter, htmlToText } from '../scripts/collect.js';
import { renderCharacterPdf, SECTION_KEYS } from '../scripts/pdf.js';
import { autoTable } from '../lib/jspdf.plugin.autotable.mjs';

// Evaluate the vendored UMD build as CommonJS (package.json is "type": "module").
const umd = { exports: {} };
new Function('module', 'exports', readFileSync(new URL('../lib/jspdf.umd.min.js', import.meta.url), 'utf8'))(umd, umd.exports);
const { jsPDF } = umd.exports;

const mv = (base, value = base, changes = []) => ({ base, value, changes });
const attr = (base, value = base) => ({ ...mv(base, value), label: '', hidden: false });
const skill = (name, value, attribute, specs = [], extra = {}) => ({ ...mv(value), name, key: name.toLowerCase(), label: name, attribute, specs, isNative: false, ...extra });

const actor = {
    name: 'Kestrel "Slot" Vance',
    img: '',
    type: 'character',
    system: {
        metatype: 'elf',
        special: 'magic',
        attributes: {
            body: attr(3), agility: { ...attr(5, 6), changes: [{ name: 'Muscle Toner', value: 1, enabled: true }] },
            reaction: attr(4), strength: attr(2), willpower: attr(4), logic: attr(3), intuition: attr(5), charisma: attr(4),
            edge: { ...attr(3), uses: 1, max: 3 }, essence: attr(6, 5.6), magic: attr(5), resonance: attr(0),
            initiation: attr(1), submersion: attr(0),
        },
        limits: { physical: mv(5), mental: mv(5), social: mv(6), astral: mv(6) },
        initiative: {
            meatspace: { constant: mv(9), dice: { ...mv(1, 2), text: '2d6' } },
            astral: { constant: mv(10), dice: { ...mv(2), text: '2d6' } },
            matrix: { constant: mv(5), dice: { ...mv(3), text: '3d6' } },
        },
        track: {
            physical: { value: 4, max: 10, overflow: { value: 0, max: 3 } },
            stun: { value: 2, max: 10 },
        },
        wounds: mv(-1),
        armor: { rating: mv(12) },
        movement: { walk: mv(10), run: mv(20) },
        values: { recoil_compensation: mv(2) },
        modifiers: { composure: 0, judge_intentions: 0, memory: 0, lift_carry: 0 },
        karma: { value: 7, max: 42 },
        nuyen: 12500, street_cred: 2, notoriety: 1, public_awareness: 0,
        skills: {
            active: {
                pistols: skill('Pistols', 5, 'agility', ['Semi-Automatics']),
                spellcasting: skill('Spellcasting', 6, 'magic'),
                perception: skill('Perception', 3, 'intuition'),
                hacking: skill('Hacking', 0, 'logic'),
            },
            language: {
                english: skill('English', 0, 'intuition', [], { isNative: true }),
                japanese: skill('Japanese', 3, 'intuition', ['Read/Write']),
            },
            knowledge: {
                street: { seattle_gangs: skill('Seattle Gangs', 4, 'intuition') },
                academic: { magical_theory: skill('Magical Theory', 3, 'logic') },
                professional: {},
                interests: { trideo: skill('Trideo Shows', 2, 'intuition') },
            },
        },
        description: { value: '<p>Former Ares security mage.</p><p>Owes <b>Lone Star</b> a favor &amp; more.</p>' },
    },
    items: [
        { type: 'quality', name: 'Mentor Spirit', system: { type: 'positive', karma: 5, rating: 0, description: { source: 'SR5 321' } } },
        { type: 'quality', name: 'Addiction', system: { type: 'negative', karma: -4, rating: 1, description: { source: '' } } },
        { type: 'weapon', name: 'Ares Predator V', system: {
            category: 'range', subcategory: 'Heavy Pistol',
            action: { limit: mv(5, 7), damage: { ...mv(8), type: { base: 'physical', value: 'physical' }, element: { value: '' }, ap: mv(-1) } },
            range: { modes: { single_shot: false, semi_auto: true }, rc: mv(0, 1) },
            ammo: { current: { value: 15, max: 15 } }, technology: { equipped: true } } },
        { type: 'weapon', name: 'Combat Knife', system: {
            category: 'melee', action: { limit: mv(6), damage: { ...mv(3, 4), type: { value: 'physical' }, ap: mv(-3) } },
            melee: { reach: 0 }, technology: { equipped: true } } },
        { type: 'armor', name: 'Armor Jacket', system: { armor: { value: 12, accessory: false }, capacity: { used: 2, total: 12 }, technology: { equipped: true } } },
        { type: 'cyberware', name: 'Datajack', system: { grade: 'alpha', essence: 0.1, technology: { rating: 1, calculated: { essence: { value: 0.08 } } } } },
        { type: 'bioware', name: 'Muscle Toner', system: { grade: 'standard', essence: 0.2, technology: { rating: 1 } } },
        { type: 'spell', name: 'Manabolt', system: { category: 'combat', type: 'mana', range: 'los', duration: 'instant', drain: -3 } },
        { type: 'adept_power', name: 'Improved Reflexes', system: { level: 1, pp: 1.5, type: 'passive' } },
        { type: 'metamagic', name: 'Masking', system: {} },
        { type: 'device', name: 'Hermes Ikon', system: { category: 'commlink', technology: { rating: 5, quantity: 1, equipped: true },
            atts: { att1: { att: 'data_processing', value: 5 }, att2: { att: 'firewall', value: 3 } } } },
        { type: 'equipment', name: 'Medkit', system: { technology: { rating: 6, quantity: 1 } } },
        { type: 'sin', name: 'Jane Smith', system: { technology: { rating: 4 }, licenses: [{ name: 'Firearms', rtg: 4 }] } },
        { type: 'lifestyle', name: 'Downtown Flat', system: { type: 'middle', cost: 5000, permanent: false } },
        { type: 'contact', name: 'Fixer Joe', system: { type: 'Fixer', connection: 4, loyalty: 3, family: false } },
        { type: 'skill', name: 'Firearms', system: { type: 'group', group: { rating: 2 } } },
    ],
};

const config = {
    attributes: { agility: 'SR5.AttrAgility' },
    specialTypes: { magic: 'SR5.Awakened' },
};
const dict = { 'SR5.AttrAgility': 'Agility', 'SR5.Awakened': 'Awakened' };
const en = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url)));
const localize = (k) => dict[k] ?? k.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), en) ?? k;
const data = collectCharacter(actor, { localize, config, player: 'Tester', exportedAt: '2026-11-24' });

// --- Assertions on collected values ---
assert.equal(data.special, 'Awakened');
assert.equal(data.attributes.find((a) => a.key === 'agility').value, '6');
assert.match(data.attributes.find((a) => a.key === 'agility').mods, /Muscle Toner \+1/);
assert.ok(data.specialAttributes.some((a) => a.key === 'magic'));
assert.ok(!data.specialAttributes.some((a) => a.key === 'resonance'));
assert.deepEqual(data.initiative.map((i) => i.value), ['9 + 2d6', '10 + 2d6']);
assert.equal(data.activeSkills.length, 3, 'untrained hacking excluded');
assert.equal(data.activeSkills.find((s) => s.name === 'Pistols').pool, '11'); // 5 + agility 6
assert.equal(data.knowledgeSkills.length, 3);
assert.equal(data.languageSkills.find((s) => s.name === 'English').rating, 'N');
assert.equal(data.weapons.find((w) => w.name === 'Ares Predator V').damage, '8P');
assert.equal(data.weapons.find((w) => w.name === 'Ares Predator V').accuracy, '7');
assert.equal(data.weapons.find((w) => w.name === 'Ares Predator V').mode, 'SA');
assert.equal(data.augmentations.find((a) => a.name === 'Datajack').essence, '0.08');
assert.equal(data.skillGroups[0].rating, '2');
assert.equal(htmlToText('<p>a</p><p>b &amp; c</p>'), 'a\nb & c');

// --- Render ---
const doc = renderCharacterPdf(jsPDF, autoTable, data, { format: 'a4', localize });
const bytes = Buffer.from(doc.output('arraybuffer'));
assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
assert.ok(doc.getNumberOfPages() >= 1);

// Section toggles: everything off except attributes gives a shorter document.
const minimal = renderCharacterPdf(jsPDF, autoTable, data, {
    sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, k === 'attributes'])),
});
assert.ok(minimal.output('arraybuffer').byteLength < bytes.byteLength);

const out = process.argv[2];
if (out) writeFileSync(out, bytes);
console.log(`ok — ${doc.getNumberOfPages()} page(s), ${bytes.length} bytes${out ? ` → ${out}` : ''}`);
