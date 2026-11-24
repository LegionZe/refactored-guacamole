/**
 * Data collection for the SR5 PDF export.
 *
 * Converts a prepared shadowrun5e Actor (system v0.37.x, Foundry v14) into a plain,
 * render-ready object. Field paths follow the system's TypeDataModel definitions in
 * https://github.com/SR5-FoundryVTT/SR5-FoundryVTT/tree/master/src/module/types
 * (see README "Data sources" for the per-field file references).
 *
 * This file has no Foundry globals at module scope so it can be unit tested in Node.
 */

/** Safe nested property read. */
export function get(obj, path, fallback = undefined) {
    let cur = obj;
    for (const key of path.split('.')) {
        if (cur === null || cur === undefined) return fallback;
        cur = cur[key];
    }
    return cur === undefined || cur === null ? fallback : cur;
}

/** Strip HTML to plain text, preserving paragraph / line breaks. */
export function htmlToText(html) {
    if (!html || typeof html !== 'string') return '';
    return html
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
        .replace(/<\s*li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const fmtNum = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
};
const signed = (v) => {
    const n = num(Number(v));
    return n > 0 ? `+${n}` : String(n);
};

const ATTRIBUTE_ORDER = ['body', 'agility', 'reaction', 'strength', 'willpower', 'logic', 'intuition', 'charisma'];
const SPECIAL_ATTRIBUTES = ['edge', 'essence', 'magic', 'resonance', 'initiation', 'submersion'];
const MATRIX_ATTRIBUTES = ['attack', 'sleaze', 'data_processing', 'firewall'];
const KNOWLEDGE_TYPES = ['street', 'academic', 'professional', 'interests'];

/**
 * @param {object} actor   SR5Actor (or a plain object with the same shape).
 * @param {object} [opts]
 * @param {(key:string)=>string} [opts.localize]  i18n function, defaults to identity.
 * @param {object} [opts.config]  CONFIG.SR5 label maps.
 * @param {object} [opts.sections] Section toggles; missing keys default to true.
 */
export function collectCharacter(actor, opts = {}) {
    const localize = opts.localize ?? ((k) => k);
    const config = opts.config ?? {};
    const L = (map, key) => {
        if (!key) return '';
        const i18nKey = get(config, `${map}.${key}`);
        if (!i18nKey) return humanize(key);
        const out = localize(i18nKey);
        return out === i18nKey ? humanize(key) : out;
    };
    const sys = actor.system ?? {};
    const items = Array.from(actor.items ?? []);
    const ofType = (...types) => items
        .filter((i) => types.includes(i.type))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    const attrValue = (key) => num(get(sys, `attributes.${key}.value`));
    const special = sys.special ?? 'mundane';

    // --- Attributes -------------------------------------------------------
    // Attributes are ModifiableFields: { base, value, changes[] } — types/template/Attributes.ts
    const attrRow = (key) => {
        const a = get(sys, `attributes.${key}`);
        if (!a) return null;
        return {
            key,
            label: L('attributes', key),
            base: fmtNum(a.base),
            value: fmtNum(a.value),
            mods: (a.changes ?? []).filter((c) => c.enabled !== false && !c.invalidated)
                .map((c) => `${c.name} ${signed(c.value)}`).join(', '),
        };
    };
    const attributes = ATTRIBUTE_ORDER.map(attrRow).filter(Boolean);
    const specialAttributes = SPECIAL_ATTRIBUTES
        .filter((key) => {
            if (key === 'magic' || key === 'initiation') return special === 'magic' || attrValue(key) > 0;
            if (key === 'resonance' || key === 'submersion') return special === 'resonance' || attrValue(key) > 0;
            return true;
        })
        .map(attrRow).filter(Boolean);
    const edge = get(sys, 'attributes.edge');
    if (edge) {
        const row = specialAttributes.find((r) => r.key === 'edge');
        // Edge uses/max: EdgeAttributeField in types/template/Attributes.ts
        if (row) row.value = `${fmtNum(edge.value)} (${localize('SR5PDF.EdgeUses')}: ${fmtNum(edge.uses)})`;
    }
    const matrixAttributes = special === 'resonance'
        ? MATRIX_ATTRIBUTES.map(attrRow).filter(Boolean)
        : [];

    // --- Limits -----------------------------------------------------------
    // CharacterLimits = Limits + AwakendLimits + MatrixLimits — types/template/Limits.ts
    const limitKeys = ['physical', 'mental', 'social'];
    if (special === 'magic') limitKeys.push('astral');
    const limits = limitKeys
        .filter((k) => get(sys, `limits.${k}`))
        .map((k) => ({ label: L('limits', k), value: fmtNum(get(sys, `limits.${k}.value`)) }));

    // --- Initiative -------------------------------------------------------
    // constant.value already includes attribute_a + attribute_b — actor/prep/functions/InitiativePrep.ts
    const initModes = ['meatspace'];
    if (special === 'magic') initModes.push('astral');
    if (special === 'resonance' || items.some((i) => i.type === 'device' && get(i, 'system.technology.equipped')
        && get(i, 'system.category') === 'cyberdeck')) initModes.push('matrix');
    const initiative = initModes
        .filter((m) => get(sys, `initiative.${m}`))
        .map((m) => ({
            label: localize(`SR5PDF.Init.${m}`),
            value: `${fmtNum(get(sys, `initiative.${m}.constant.value`))} + ${fmtNum(get(sys, `initiative.${m}.dice.value`))}d6`,
        }));

    // --- Condition monitors -----------------------------------------------
    // Tracks('physical','stun') — types/template/ConditionMonitors.ts
    const track = (path) => {
        const t = get(sys, path);
        if (!t) return null;
        return { value: num(t.value), max: num(t.max) };
    };
    const conditionMonitors = {
        physical: track('track.physical'),
        stun: track('track.stun'),
        overflow: track('track.physical.overflow'),
        woundModifier: num(get(sys, 'wounds.value')),
    };

    // --- Derived / misc ---------------------------------------------------
    const derived = [
        [localize('SR5PDF.Armor'), fmtNum(get(sys, 'armor.rating.value', get(sys, 'armor.value')))],
        [localize('SR5PDF.Walk'), fmtNum(get(sys, 'movement.walk.value'))],
        [localize('SR5PDF.Run'), fmtNum(get(sys, 'movement.run.value'))],
        [localize('SR5PDF.Composure'), fmtNum(attrValue('willpower') + attrValue('charisma') + num(get(sys, 'modifiers.composure')))],
        [localize('SR5PDF.JudgeIntentions'), fmtNum(attrValue('intuition') + attrValue('charisma') + num(get(sys, 'modifiers.judge_intentions')))],
        [localize('SR5PDF.Memory'), fmtNum(attrValue('logic') + attrValue('willpower') + num(get(sys, 'modifiers.memory')))],
        [localize('SR5PDF.LiftCarry'), fmtNum(attrValue('body') + attrValue('strength') + num(get(sys, 'modifiers.lift_carry')))],
        [localize('SR5PDF.RecoilComp'), fmtNum(get(sys, 'values.recoil_compensation.value'))],
    ];

    const resources = [
        [localize('SR5PDF.Karma'), `${fmtNum(get(sys, 'karma.value'))} / ${fmtNum(get(sys, 'karma.max'))}`],
        [localize('SR5PDF.Nuyen'), `${fmtNum(get(sys, 'nuyen'))}¥`],
        [localize('SR5PDF.StreetCred'), fmtNum(get(sys, 'street_cred'))],
        [localize('SR5PDF.Notoriety'), fmtNum(get(sys, 'notoriety'))],
        [localize('SR5PDF.PublicAwareness'), fmtNum(get(sys, 'public_awareness'))],
    ];

    // --- Skills -----------------------------------------------------------
    // system.skills is derived from skill items — actor/prep/functions/SkillFieldPrep.ts
    // Each entry: { name, label, value, attribute, specs[], isNative, ... } — types/template/Skills.ts
    const skillRow = (s, withPool = true) => {
        const attr = s.attribute;
        const rating = num(s.value);
        return {
            name: s.label || s.name || s.key,
            rating: fmtNum(rating),
            attribute: attr ? L('attributes', attr) : '',
            pool: withPool && attr ? fmtNum(rating + attrValue(attr)) : '',
            specs: (s.specs ?? []).filter(Boolean).join(', '),
            native: !!s.isNative,
        };
    };
    const sortByName = (a, b) => a.name.localeCompare(b.name);
    const activeSkills = Object.values(get(sys, 'skills.active', {}))
        .filter((s) => num(s.value) > 0 || (opts.includeUntrainedSkills ?? false))
        .map((s) => skillRow(s)).sort(sortByName);
    const knowledgeSkills = [];
    for (const type of KNOWLEDGE_TYPES) {
        // knowledge.<type> is a TypedObjectField keyed by skill key in the current model,
        // but older data had { attribute, value: {...} } (KnowledgeSkillList). Handle both.
        const group = get(sys, `skills.knowledge.${type}`, {});
        const entries = group && typeof group.value === 'object' && !('base' in group)
            ? Object.values(group.value)
            : Object.values(group);
        for (const s of entries) {
            if (!s || typeof s !== 'object') continue;
            knowledgeSkills.push({ ...skillRow(s), category: localize(`SR5PDF.Knowledge.${type}`) });
        }
    }
    knowledgeSkills.sort(sortByName);
    const languageSkills = Object.values(get(sys, 'skills.language', {}))
        .map((s) => {
            const r = skillRow(s);
            if (r.native) r.rating = localize('SR5PDF.Native');
            return r;
        }).sort(sortByName);
    const skillGroups = ofType('skill')
        .filter((i) => get(i, 'system.type') === 'group')
        .map((i) => ({ name: i.name, rating: fmtNum(get(i, 'system.group.rating')) }));

    // --- Items ------------------------------------------------------------
    const qualities = ofType('quality').map((i) => ({
        name: i.name + (num(get(i, 'system.rating')) > 0 ? ` (${get(i, 'system.rating')})` : ''),
        type: L('qualityTypes', get(i, 'system.type')),
        karma: fmtNum(get(i, 'system.karma')),
        source: get(i, 'system.description.source', ''),
    }));

    // Weapon: types/item/Weapon.ts; action/damage: types/item/Action.ts
    const weapons = ofType('weapon').map((i) => {
        const s = i.system ?? {};
        const category = s.category ?? '';
        const dmgType = get(s, 'action.damage.type.value') || get(s, 'action.damage.type.base') || '';
        const dmgVal = get(s, 'action.damage.value', get(s, 'action.damage.base', 0));
        const element = get(s, 'action.damage.element.value', '');
        const modes = get(s, 'range.modes', {});
        const modeList = [
            modes.single_shot && 'SS', modes.semi_auto && 'SA', modes.burst_fire && 'BF', modes.full_auto && 'FA',
        ].filter(Boolean).join('/');
        const ammo = get(s, 'ammo.current.max', 0) > 0
            ? `${fmtNum(get(s, 'ammo.current.value'))}/${fmtNum(get(s, 'ammo.current.max'))}`
            : '';
        return {
            name: i.name,
            category: L('weaponCategories', category) + (s.subcategory ? ` (${s.subcategory})` : ''),
            accuracy: fmtNum(get(s, 'action.limit.value', get(s, 'action.limit.base'))),
            damage: `${fmtNum(dmgVal)}${dmgType ? dmgType.charAt(0).toUpperCase() : ''}${element ? ` (${humanize(element)})` : ''}`,
            ap: fmtNum(get(s, 'action.damage.ap.value', get(s, 'action.damage.ap.base', 0))),
            mode: category === 'range' ? modeList : '',
            rc: category === 'range' ? fmtNum(get(s, 'range.rc.value', get(s, 'range.rc.base'))) : '',
            reach: category === 'melee' ? fmtNum(get(s, 'melee.reach')) : '',
            ammo,
            equipped: !!get(s, 'technology.equipped'),
        };
    });

    // Armor: types/item/Armor.ts
    const armor = ofType('armor').map((i) => ({
        name: i.name,
        rating: (get(i, 'system.armor.accessory') ? '+' : '') + fmtNum(get(i, 'system.armor.value', get(i, 'system.armor.base'))),
        capacity: num(get(i, 'system.capacity.total')) > 0
            ? `${fmtNum(get(i, 'system.capacity.used'))}/${fmtNum(get(i, 'system.capacity.total'))}` : '',
        equipped: !!get(i, 'system.technology.equipped'),
    }));

    // Cyberware / Bioware: types/item/Cyberware.ts, Bioware.ts
    const augmentations = ofType('cyberware', 'bioware').map((i) => ({
        name: i.name,
        kind: i.type === 'cyberware' ? localize('SR5PDF.Cyberware') : localize('SR5PDF.Bioware'),
        rating: fmtNum(get(i, 'system.technology.rating')),
        grade: L('cyberwareGrades', get(i, 'system.grade')),
        essence: fmtNum(get(i, 'system.technology.calculated.essence.value') || get(i, 'system.essence')),
    }));

    // Spell: types/item/Spell.ts
    const spells = ofType('spell').map((i) => ({
        name: i.name,
        category: L('spellCategories', get(i, 'system.category')),
        type: L('spellTypes', get(i, 'system.type')),
        range: L('spellRanges', get(i, 'system.range')),
        duration: L('durations', get(i, 'system.duration')),
        drain: signed(get(i, 'system.drain')),
    }));

    // Adept powers: types/item/AdeptPower.ts
    const adeptPowers = ofType('adept_power').map((i) => ({
        name: i.name,
        level: num(get(i, 'system.level')) > 0 ? fmtNum(get(i, 'system.level')) : '',
        pp: fmtNum(get(i, 'system.pp')),
        type: L('adeptPower.types', get(i, 'system.type')),
    }));

    // Complex forms: types/item/ComplexForm.ts
    const complexForms = ofType('complex_form').map((i) => ({
        name: i.name,
        target: L('matrixTargets', get(i, 'system.target')),
        duration: L('complexForm.durations', get(i, 'system.duration')),
        fade: signed(get(i, 'system.fade')),
    }));

    const powers = ofType('critter_power', 'metamagic', 'echo', 'sprite_power').map((i) => ({
        name: i.name,
        kind: humanize(i.type),
        rating: num(get(i, 'system.rating')) > 0 ? fmtNum(get(i, 'system.rating')) : '',
    }));

    // Gear with TechnologyData — types/template/Technology.ts
    const gearRow = (i) => ({
        name: i.name,
        kind: humanize(i.type === 'device' ? (get(i, 'system.category') || 'device') : i.type),
        rating: fmtNum(get(i, 'system.technology.rating')),
        quantity: fmtNum(get(i, 'system.technology.quantity')),
        equipped: !!get(i, 'system.technology.equipped'),
    });
    const devices = ofType('device').map((i) => ({
        ...gearRow(i),
        // Device matrix attributes: types/item/Device.ts (atts = MatrixAttributes)
        atts: ['att1', 'att2', 'att3', 'att4']
            .map((k) => get(i, `system.atts.${k}`))
            .filter((a) => a && a.att)
            .map((a) => `${humanize(a.att).slice(0, 3)} ${fmtNum(a.value)}`)
            .join(' '),
    }));
    const gear = ofType('equipment', 'ammo', 'program', 'modification').map(gearRow);

    // SIN: types/item/Sin.ts (licenses[] { name, rtg })
    const sins = ofType('sin').map((i) => ({
        name: i.name,
        rating: fmtNum(get(i, 'system.technology.rating')),
        licenses: (get(i, 'system.licenses', []) ?? [])
            .map((l) => `${l.name} (${fmtNum(l.rtg)})`).join(', '),
    }));

    // Lifestyle: types/item/Lifestyle.ts
    const lifestyles = ofType('lifestyle').map((i) => ({
        name: i.name,
        type: L('lifestyleTypes', get(i, 'system.type')),
        cost: `${fmtNum(get(i, 'system.cost'))}¥`,
        permanent: !!get(i, 'system.permanent'),
    }));

    // Contact: types/item/Contact.ts
    const contacts = ofType('contact').map((i) => ({
        name: i.name,
        type: get(i, 'system.type', ''),
        connection: fmtNum(get(i, 'system.connection')),
        loyalty: fmtNum(get(i, 'system.loyalty')),
        notes: [get(i, 'system.family') && 'Family', get(i, 'system.blackmail') && 'Blackmail', get(i, 'system.group') && 'Group']
            .filter(Boolean).join(', '),
    }));

    return {
        name: actor.name ?? '',
        img: actor.img ?? '',
        player: opts.player ?? '',
        metatype: L('character.types', sys.metatype) || humanize(sys.metatype),
        special: L('specialTypes', special),
        exportedAt: opts.exportedAt ?? '',
        attributes,
        specialAttributes,
        matrixAttributes,
        limits,
        initiative,
        conditionMonitors,
        derived,
        resources,
        activeSkills,
        skillGroups,
        knowledgeSkills,
        languageSkills,
        qualities,
        weapons,
        armor,
        augmentations,
        spells,
        adeptPowers,
        complexForms,
        powers,
        devices,
        gear,
        sins,
        lifestyles,
        contacts,
        description: htmlToText(get(sys, 'description.value', '')),
    };
}

export function humanize(key) {
    if (!key || typeof key !== 'string') return '';
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
