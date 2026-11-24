/**
 * SR5 Character PDF Export — Foundry VTT v14 module entry point.
 *
 * Hooks used (Foundry v14 API, https://foundryvtt.com/api/v14/modules/hookEvents.html):
 *  - getHeaderControlsApplicationV2(application, controls): adds a header control to actor sheets.
 *  - getActorContextOptions(application, menuItems): adds an entry to the Actors sidebar context menu
 *    (the "getDocumentContextOptions" hook with "Document" substituted).
 */
import { collectCharacter } from './collect.js';
import { renderCharacterPdf, SECTION_KEYS } from './pdf.js';
import { autoTable } from '../lib/jspdf.plugin.autotable.mjs';

const MODULE_ID = 'sr5-pdf-export';
const SYSTEM_ID = 'shadowrun5e';

let jsPdfPromise = null;
/** Lazily load the vendored jsPDF UMD build; it registers window.jspdf. */
function loadJsPdf() {
    if (globalThis.jspdf?.jsPDF) return Promise.resolve(globalThis.jspdf.jsPDF);
    jsPdfPromise ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `modules/${MODULE_ID}/lib/jspdf.umd.min.js`;
        script.onload = () => (globalThis.jspdf?.jsPDF ? resolve(globalThis.jspdf.jsPDF) : reject(new Error('jsPDF did not register')));
        script.onerror = () => reject(new Error(`Failed to load ${script.src}`));
        document.head.appendChild(script);
    }).catch((err) => {
        jsPdfPromise = null;
        throw err;
    });
    return jsPdfPromise;
}

/** Convert the actor portrait to a JPEG data URL via canvas (handles webp/svg/png sources). */
async function imageToDataUrl(src, size = 300) {
    if (!src) return null;
    try {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.src = src;
        await el.decode();
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, size / Math.max(el.naturalWidth, el.naturalHeight));
        // Square crop centred on the image so it fits the square header slot.
        const side = Math.min(el.naturalWidth, el.naturalHeight);
        canvas.width = canvas.height = Math.max(1, Math.round(side * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(el, (el.naturalWidth - side) / 2, (el.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
    } catch (err) {
        console.warn(`${MODULE_ID} | could not load portrait ${src}`, err);
        return null;
    }
}

function ownerNames(actor) {
    return game.users
        .filter((u) => !u.isGM && actor.testUserPermission(u, 'OWNER'))
        .map((u) => u.name)
        .join(', ');
}

function safeFilename(name) {
    return (name || 'character').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'character';
}

function canExport(actor) {
    return !!actor && actor.type === 'character' && actor.isOwner;
}

/**
 * Build and download the PDF for an actor.
 * @param {Actor} actor
 * @param {object} [options] { sections, format, portrait, includeUntrainedSkills }
 */
export async function exportActorPdf(actor, options = {}) {
    if (!actor) throw new Error('No actor given');
    if (actor.type !== 'character') {
        ui.notifications.warn(game.i18n.localize('SR5PDF.Notify.OnlyCharacters'));
        return null;
    }
    const format = options.format ?? game.settings.get(MODULE_ID, 'pageFormat');
    const includePortrait = options.portrait ?? game.settings.get(MODULE_ID, 'includePortrait');
    const includeUntrainedSkills = options.includeUntrainedSkills ?? game.settings.get(MODULE_ID, 'includeUntrainedSkills');

    const JsPDF = await loadJsPdf();
    const data = collectCharacter(actor, {
        localize: (k) => game.i18n.localize(k),
        config: CONFIG.SR5 ?? {},
        player: ownerNames(actor),
        exportedAt: new Date().toLocaleDateString(game.i18n.lang),
        includeUntrainedSkills,
    });
    const portrait = includePortrait ? await imageToDataUrl(actor.img) : null;
    const doc = renderCharacterPdf(JsPDF, autoTable, data, {
        format,
        portrait,
        localize: (k) => game.i18n.localize(k),
        sections: options.sections,
    });
    const filename = `${safeFilename(actor.name)}.pdf`;
    if (options.returnBlob) return doc.output('blob');
    doc.save(filename);
    ui.notifications.info(game.i18n.format('SR5PDF.Notify.Exported', { name: actor.name }));
    return filename;
}

/** Dialog letting the user pick sections before exporting. */
async function promptAndExport(actor) {
    if (!canExport(actor)) return;
    const lastSections = game.settings.get(MODULE_ID, 'lastSections') ?? {};
    const checkboxes = SECTION_KEYS.map((key) => {
        const checked = lastSections[key] !== false ? 'checked' : '';
        return `<label style="display:block;margin:2px 0"><input type="checkbox" name="${key}" ${checked}> ${game.i18n.localize(`SR5PDF.Section.${key}`)}</label>`;
    }).join('');
    const content = `<div class="sr5-pdf-export-dialog">
        <p>${game.i18n.localize('SR5PDF.Dialog.Hint')}</p>
        <fieldset><legend>${game.i18n.localize('SR5PDF.Dialog.Sections')}</legend>${checkboxes}</fieldset>
    </div>`;

    const result = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.format('SR5PDF.Dialog.Title', { name: actor.name }), icon: 'fa-solid fa-file-pdf' },
        content,
        ok: {
            label: game.i18n.localize('SR5PDF.Dialog.Export'),
            icon: 'fa-solid fa-file-export',
            callback: (event, button) => {
                const form = button.form;
                return Object.fromEntries(SECTION_KEYS.map((k) => [k, !!form.elements[k]?.checked]));
            },
        },
        rejectClose: false,
    });
    if (!result) return;
    await game.settings.set(MODULE_ID, 'lastSections', result);
    try {
        await exportActorPdf(actor, { sections: result });
    } catch (err) {
        console.error(`${MODULE_ID} | export failed`, err);
        ui.notifications.error(game.i18n.format('SR5PDF.Notify.Failed', { error: err.message }));
    }
}

/**
 * Diagnostic: logs the exact data structure the exporter reads for an actor, so field
 * paths can be verified against a live world before changing the exporter.
 */
function diagnose(actor) {
    actor ??= canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
    if (!actor) {
        ui.notifications.warn('Select a token or assign a character first.');
        return null;
    }
    const sys = actor.system;
    const itemTypes = {};
    for (const item of actor.items) {
        (itemTypes[item.type] ??= []).push({ name: item.name, system: item.system.toObject?.() ?? item.system });
    }
    const report = {
        systemVersion: game.system.version,
        foundryVersion: game.version,
        actor: { name: actor.name, type: actor.type, special: sys.special, metatype: sys.metatype },
        attributes: foundry.utils.deepClone(sys.attributes),
        limits: foundry.utils.deepClone(sys.limits),
        initiative: foundry.utils.deepClone(sys.initiative),
        track: foundry.utils.deepClone(sys.track),
        skills: foundry.utils.deepClone(sys.skills),
        itemTypes,
        collected: collectCharacter(actor, { localize: (k) => game.i18n.localize(k), config: CONFIG.SR5 ?? {} }),
    };
    console.log(`${MODULE_ID} | diagnostic for ${actor.name}`, report);
    return report;
}

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, 'pageFormat', {
        name: 'SR5PDF.Settings.PageFormat.Name',
        hint: 'SR5PDF.Settings.PageFormat.Hint',
        scope: 'client',
        config: true,
        type: String,
        choices: { a4: 'A4', letter: 'US Letter' },
        default: 'a4',
    });
    game.settings.register(MODULE_ID, 'includePortrait', {
        name: 'SR5PDF.Settings.Portrait.Name',
        hint: 'SR5PDF.Settings.Portrait.Hint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, 'includeUntrainedSkills', {
        name: 'SR5PDF.Settings.Untrained.Name',
        hint: 'SR5PDF.Settings.Untrained.Hint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, 'lastSections', {
        scope: 'client',
        config: false,
        type: Object,
        default: {},
    });
});

Hooks.once('ready', () => {
    if (game.system.id !== SYSTEM_ID) {
        console.warn(`${MODULE_ID} | inactive: requires the ${SYSTEM_ID} system (current: ${game.system.id})`);
        return;
    }
    const module = game.modules.get(MODULE_ID);
    if (module) module.api = { exportActorPdf, promptAndExport, diagnose, collectCharacter };
});

// Actor sheet header control (fires for every ApplicationV2 in the inheritance chain).
Hooks.on('getHeaderControlsApplicationV2', (application, controls) => {
    if (game.system.id !== SYSTEM_ID) return;
    const actor = application.document ?? application.actor;
    if (!(actor instanceof Actor) || application.document !== actor) return;
    if (!canExport(actor)) return;
    if (controls.some((c) => c.action === 'sr5PdfExport')) return;
    controls.push({
        action: 'sr5PdfExport',
        icon: 'fa-solid fa-file-pdf',
        label: 'SR5PDF.Control.Export',
        onClick: () => promptAndExport(actor),
    });
});

// Actors sidebar directory context menu.
Hooks.on('getActorContextOptions', (application, menuItems) => {
    if (game.system.id !== SYSTEM_ID) return;
    const actorFromTarget = (target) => {
        const li = target?.closest?.('[data-entry-id]') ?? target;
        const id = li?.dataset?.entryId ?? li?.dataset?.documentId;
        return id ? game.actors.get(id) : null;
    };
    menuItems.push({
        label: 'SR5PDF.Control.Export',
        icon: '<i class="fa-solid fa-file-pdf"></i>',
        visible: (target) => canExport(actorFromTarget(target)),
        onClick: (event, target) => promptAndExport(actorFromTarget(target)),
    });
});
