/**
 * PDF rendering for the SR5 character export, using jsPDF + jspdf-autotable (both MIT, vendored in /lib).
 * Takes the plain object built by collect.js. No Foundry globals: testable in Node.
 */

const COLORS = {
    accent: [178, 34, 52],
    dark: [33, 33, 33],
    muted: [110, 110, 110],
    head: [45, 45, 45],
    stripe: [245, 245, 245],
};

/**
 * @param {Function} JsPDF  jsPDF constructor.
 * @param {Function} autoTable  jspdf-autotable function (doc, options).
 * @param {object} data  Output of collectCharacter().
 * @param {object} [opts]
 * @param {string} [opts.format] 'a4' | 'letter'
 * @param {string} [opts.portrait] data URL (JPEG/PNG) of the actor image.
 * @param {(k:string)=>string} [opts.localize]
 * @param {object} [opts.sections] Section toggles, keys as in SECTION_KEYS.
 * @returns {object} jsPDF document
 */
export function renderCharacterPdf(JsPDF, autoTable, data, opts = {}) {
    const t = opts.localize ?? ((k) => k);
    const show = (key) => opts.sections?.[key] !== false;
    const doc = new JsPDF({ unit: 'mm', format: opts.format ?? 'a4', orientation: 'portrait' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 12; // margin
    const contentW = pageW - 2 * M;
    let y = M;

    doc.setProperties({ title: data.name, subject: 'Shadowrun 5e character', creator: 'sr5-pdf-export' });

    // ---- Header ----------------------------------------------------------
    const headerH = 30;
    let textX = M;
    if (opts.portrait) {
        try {
            const fmt = opts.portrait.startsWith('data:image/png') ? 'PNG' : 'JPEG';
            doc.addImage(opts.portrait, fmt, M, y, headerH, headerH);
            textX = M + headerH + 4;
        } catch (err) {
            console.warn('sr5-pdf-export | portrait could not be embedded', err);
        }
    }
    doc.setTextColor(...COLORS.accent);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(data.name || '—', textX, y + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.dark);
    const subtitle = [data.metatype, data.special].filter(Boolean).join(' · ');
    doc.text(subtitle, textX, y + 15);
    doc.setTextColor(...COLORS.muted);
    doc.setFontSize(8);
    const meta = [data.player && `${t('SR5PDF.Player')}: ${data.player}`, data.exportedAt && `${t('SR5PDF.Exported')}: ${data.exportedAt}`]
        .filter(Boolean).join('   ');
    if (meta) doc.text(meta, textX, y + 21);
    y += headerH + 2;
    doc.setDrawColor(...COLORS.accent);
    doc.setLineWidth(0.6);
    doc.line(M, y, pageW - M, y);
    y += 4;

    // ---- Helpers ---------------------------------------------------------
    const baseTable = {
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.2, textColor: COLORS.dark, lineColor: [200, 200, 200], lineWidth: 0.1 },
        headStyles: { fillColor: COLORS.head, textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: COLORS.stripe },
        margin: { left: M, right: M, top: M, bottom: M + 4 },
    };
    const lastY = () => doc.lastAutoTable?.finalY ?? y;
    const ensureSpace = (needed) => {
        if (y + needed > pageH - M - 4) {
            doc.addPage();
            y = M;
        }
    };
    const heading = (text) => {
        ensureSpace(14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...COLORS.accent);
        doc.text(text.toUpperCase(), M, y + 4);
        y += 6;
    };
    const table = (title, head, body, extra = {}) => {
        if (!body || body.length === 0) return;
        if (title) heading(title);
        autoTable(doc, { ...baseTable, startY: y, head: [head], body, ...extra });
        y = lastY() + 5;
    };
    /** Two tables side by side, starting at the same y. */
    const twoColumns = (left, right) => {
        const gap = 4;
        const colW = (contentW - gap) / 2;
        ensureSpace(20);
        const startY = y;
        let endLeft = startY;
        let endRight = startY;
        const draw = (spec, x) => {
            if (!spec || !spec.body?.length) return startY;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(...COLORS.accent);
            doc.text(spec.title.toUpperCase(), x, startY + 4);
            autoTable(doc, {
                ...baseTable,
                startY: startY + 6,
                head: [spec.head],
                body: spec.body,
                tableWidth: colW,
                margin: { ...baseTable.margin, left: x, right: pageW - x - colW },
                ...(spec.extra ?? {}),
            });
            return lastY();
        };
        const pageBefore = doc.getNumberOfPages();
        endLeft = draw(left, M);
        const pageAfterLeft = doc.getNumberOfPages();
        if (pageAfterLeft !== pageBefore) doc.setPage(pageBefore);
        endRight = draw(right, M + colW + gap);
        const pageAfterRight = doc.getNumberOfPages();
        // If either column overflowed onto a new page, continue below on the last page.
        if (Math.max(pageAfterLeft, pageAfterRight) !== pageBefore) {
            doc.setPage(doc.getNumberOfPages());
            y = (pageAfterLeft >= pageAfterRight ? endLeft : endRight) + 5;
        } else {
            y = Math.max(endLeft, endRight) + 5;
        }
    };
    const check = (b) => (b ? 'X' : '');

    // ---- Attributes + derived -------------------------------------------
    if (show('attributes')) {
        const attrBody = [...data.attributes, ...data.specialAttributes, ...data.matrixAttributes]
            .map((a) => [a.label, a.base, a.value]);
        const derivedBody = [
            ...data.limits.map((l) => [`${t('SR5PDF.Limit')}: ${l.label}`, l.value]),
            ...data.initiative.map((i) => [`${t('SR5PDF.Initiative')}: ${i.label}`, i.value]),
            ...data.derived,
        ];
        twoColumns(
            { title: t('SR5PDF.Attributes'), head: [t('SR5PDF.Attribute'), t('SR5PDF.Base'), t('SR5PDF.Value')], body: attrBody,
                extra: { columnStyles: { 1: { halign: 'center', cellWidth: 14 }, 2: { halign: 'center', cellWidth: 30 } } } },
            { title: t('SR5PDF.Derived'), head: [t('SR5PDF.Stat'), t('SR5PDF.Value')], body: derivedBody,
                extra: { columnStyles: { 1: { halign: 'center', cellWidth: 26 } } } },
        );
    }

    // ---- Condition monitors ---------------------------------------------
    if (show('condition')) {
        heading(t('SR5PDF.ConditionMonitors'));
        const cm = data.conditionMonitors;
        const drawTrack = (label, trk, x, yy) => {
            if (!trk || trk.max <= 0) return yy;
            const box = 4.2;
            const perRow = 12;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...COLORS.dark);
            doc.text(`${label} (${trk.value}/${trk.max})`, x, yy + 3);
            const rows = Math.ceil(trk.max / perRow);
            for (let i = 0; i < trk.max; i++) {
                const bx = x + (i % perRow) * box;
                const by = yy + 5 + Math.floor(i / perRow) * box;
                doc.setDrawColor(...COLORS.dark);
                doc.setLineWidth(0.2);
                doc.setFillColor(...(i < trk.value ? COLORS.accent : [255, 255, 255]));
                doc.rect(bx, by, box, box, 'FD');
                // Wound modifier marker every 3 boxes of damage.
                if ((i + 1) % 3 === 0) {
                    doc.setFontSize(5);
                    doc.setTextColor(...COLORS.muted);
                    doc.text(`-${(i + 1) / 3}`, bx + box / 2, by + box - 0.8, { align: 'center' });
                }
            }
            return yy + 5 + rows * box + 2;
        };
        ensureSpace(32);
        const colW = contentW / 3;
        const ends = [
            drawTrack(t('SR5PDF.Physical'), cm.physical, M, y),
            drawTrack(t('SR5PDF.Stun'), cm.stun, M + colW, y),
            drawTrack(t('SR5PDF.Overflow'), cm.overflow, M + 2 * colW, y),
        ];
        y = Math.max(...ends) + 1;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.dark);
        doc.text(`${t('SR5PDF.WoundModifier')}: ${cm.woundModifier}`, M, y + 3);
        y += 8;
    }

    // ---- Resources -------------------------------------------------------
    if (show('resources')) {
        table(t('SR5PDF.Resources'), data.resources.map((r) => r[0]), [data.resources.map((r) => r[1])],
            { styles: { ...baseTable.styles, halign: 'center' } });
    }

    // ---- Skills ----------------------------------------------------------
    if (show('skills')) {
        table(t('SR5PDF.ActiveSkills'),
            [t('SR5PDF.Skill'), t('SR5PDF.Rating'), t('SR5PDF.Attribute'), t('SR5PDF.Pool'), t('SR5PDF.Specializations')],
            data.activeSkills.map((s) => [s.name, s.rating, s.attribute, s.pool, s.specs]),
            { columnStyles: { 1: { halign: 'center', cellWidth: 14 }, 3: { halign: 'center', cellWidth: 14 } } });
        table(t('SR5PDF.SkillGroups'), [t('SR5PDF.Name'), t('SR5PDF.Rating')],
            data.skillGroups.map((g) => [g.name, g.rating]), { columnStyles: { 1: { halign: 'center', cellWidth: 20 } } });
        twoColumns(
            { title: t('SR5PDF.KnowledgeSkills'), head: [t('SR5PDF.Skill'), t('SR5PDF.Category'), t('SR5PDF.Rating')],
                body: data.knowledgeSkills.map((s) => [s.specs ? `${s.name} (${s.specs})` : s.name, s.category, s.rating]),
                extra: { columnStyles: { 2: { halign: 'center', cellWidth: 12 } } } },
            { title: t('SR5PDF.Languages'), head: [t('SR5PDF.Language'), t('SR5PDF.Rating')],
                body: data.languageSkills.map((s) => [s.specs ? `${s.name} (${s.specs})` : s.name, s.rating]),
                extra: { columnStyles: { 1: { halign: 'center', cellWidth: 16 } } } },
        );
    }

    if (show('qualities')) {
        table(t('SR5PDF.Qualities'), [t('SR5PDF.Name'), t('SR5PDF.Type'), t('SR5PDF.Karma'), t('SR5PDF.Source')],
            data.qualities.map((q) => [q.name, q.type, q.karma, q.source]),
            { columnStyles: { 2: { halign: 'center', cellWidth: 14 } } });
    }

    if (show('combat')) {
        table(t('SR5PDF.Weapons'),
            [t('SR5PDF.Name'), t('SR5PDF.Category'), t('SR5PDF.Acc'), t('SR5PDF.Damage'), t('SR5PDF.AP'),
                t('SR5PDF.Mode'), t('SR5PDF.RC'), t('SR5PDF.Reach'), t('SR5PDF.Ammo'), t('SR5PDF.Eq')],
            data.weapons.map((w) => [w.name, w.category, w.accuracy, w.damage, w.ap, w.mode, w.rc, w.reach, w.ammo, check(w.equipped)]),
            { columnStyles: { 2: { halign: 'center' }, 4: { halign: 'center' }, 6: { halign: 'center' }, 7: { halign: 'center' }, 9: { halign: 'center' } } });
        table(t('SR5PDF.ArmorItems'), [t('SR5PDF.Name'), t('SR5PDF.Rating'), t('SR5PDF.Capacity'), t('SR5PDF.Eq')],
            data.armor.map((a) => [a.name, a.rating, a.capacity, check(a.equipped)]),
            { columnStyles: { 1: { halign: 'center', cellWidth: 16 }, 3: { halign: 'center', cellWidth: 10 } } });
    }

    if (show('augmentations')) {
        table(t('SR5PDF.Augmentations'), [t('SR5PDF.Name'), t('SR5PDF.Type'), t('SR5PDF.Rating'), t('SR5PDF.Grade'), t('SR5PDF.Essence')],
            data.augmentations.map((a) => [a.name, a.kind, a.rating, a.grade, a.essence]),
            { columnStyles: { 2: { halign: 'center' }, 4: { halign: 'center' } } });
    }

    if (show('magic')) {
        table(t('SR5PDF.Spells'), [t('SR5PDF.Name'), t('SR5PDF.Category'), t('SR5PDF.Type'), t('SR5PDF.Range'), t('SR5PDF.Duration'), t('SR5PDF.Drain')],
            data.spells.map((s) => [s.name, s.category, s.type, s.range, s.duration, s.drain]),
            { columnStyles: { 5: { halign: 'center' } } });
        table(t('SR5PDF.AdeptPowers'), [t('SR5PDF.Name'), t('SR5PDF.Level'), t('SR5PDF.PP'), t('SR5PDF.Type')],
            data.adeptPowers.map((p) => [p.name, p.level, p.pp, p.type]),
            { columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } } });
        table(t('SR5PDF.ComplexForms'), [t('SR5PDF.Name'), t('SR5PDF.Target'), t('SR5PDF.Duration'), t('SR5PDF.Fade')],
            data.complexForms.map((c) => [c.name, c.target, c.duration, c.fade]),
            { columnStyles: { 3: { halign: 'center' } } });
        table(t('SR5PDF.Powers'), [t('SR5PDF.Name'), t('SR5PDF.Type'), t('SR5PDF.Rating')],
            data.powers.map((p) => [p.name, p.kind, p.rating]));
    }

    if (show('gear')) {
        table(t('SR5PDF.Devices'), [t('SR5PDF.Name'), t('SR5PDF.Type'), t('SR5PDF.Rating'), t('SR5PDF.MatrixAtts'), t('SR5PDF.Eq')],
            data.devices.map((d) => [d.name, d.kind, d.rating, d.atts, check(d.equipped)]),
            { columnStyles: { 2: { halign: 'center' }, 4: { halign: 'center', cellWidth: 10 } } });
        table(t('SR5PDF.Gear'), [t('SR5PDF.Name'), t('SR5PDF.Type'), t('SR5PDF.Rating'), t('SR5PDF.Qty'), t('SR5PDF.Eq')],
            data.gear.map((g) => [g.name, g.kind, g.rating, g.quantity, check(g.equipped)]),
            { columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center', cellWidth: 10 } } });
    }

    if (show('identity')) {
        table(t('SR5PDF.SINs'), [t('SR5PDF.Name'), t('SR5PDF.Rating'), t('SR5PDF.Licenses')],
            data.sins.map((s) => [s.name, s.rating, s.licenses]), { columnStyles: { 1: { halign: 'center', cellWidth: 16 } } });
        table(t('SR5PDF.Lifestyles'), [t('SR5PDF.Name'), t('SR5PDF.Type'), t('SR5PDF.Cost'), t('SR5PDF.Permanent')],
            data.lifestyles.map((l) => [l.name, l.type, l.cost, check(l.permanent)]));
        table(t('SR5PDF.Contacts'), [t('SR5PDF.Name'), t('SR5PDF.Type'), t('SR5PDF.Connection'), t('SR5PDF.Loyalty'), t('SR5PDF.Notes')],
            data.contacts.map((c) => [c.name, c.type, c.connection, c.loyalty, c.notes]),
            { columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center' } } });
    }

    if (show('description') && data.description) {
        heading(t('SR5PDF.Description'));
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...COLORS.dark);
        const lines = doc.splitTextToSize(data.description, contentW);
        const lineH = 4;
        for (const line of lines) {
            ensureSpace(lineH);
            doc.text(line, M, y + 3);
            y += lineH;
        }
    }

    // ---- Footer: page numbers -------------------------------------------
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...COLORS.muted);
        doc.text(`${data.name} — ${p} / ${pages}`, pageW - M, pageH - 6, { align: 'right' });
    }
    return doc;
}

export const SECTION_KEYS = [
    'attributes', 'condition', 'resources', 'skills', 'qualities', 'combat',
    'augmentations', 'magic', 'gear', 'identity', 'description',
];
