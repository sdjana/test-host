/**
 * Copyright (c) 2024-2026 D2Sol Inc. All rights reserved.
 *
 * CONFIDENTIAL AND PROPRIETARY
 *
 * @file d2s-smartinsights.js
 * @description Client-side Smart Insights integration for the Curam caseworker
 *              webclient. Hooks into Curam's Dojo-based tab navigation system
 *              to capture page context and trigger page-specific insights.
 *
 *              Supports:
 *              - Priority 1: Verification Date Guidance on Add Proof modals
 *              - Priority 2: Change Type Selection on Edit Evidence modals
 *              - General page-level insights (Income Support Application, etc.)
 *
 * @requires dojo/ready
 * @requires dojo/topic
 */

console.log("Smart Insights Bundle loaded");

// ====================================================================
// Utility: Read hidden input field values from the top-level document
// ====================================================================

function getHiddenInputValue(name) {
    var input = document.querySelector('input[type="hidden"][name="' + name + '"]');
    return input ? input.value : "";
}

// ====================================================================
// Utility: Extract page context from a Curam content-panel iframe
// ====================================================================

function getPageInfo(iframe) {
    var info = { pageId: null, params: {}, title: null };
    try {
        var src = iframe.getAttribute("data-content-url") || iframe.src || "";
        var qs = src.split("?")[1];
        if (qs) {
            qs.split("&").forEach(function (pair) {
                var kv = pair.split("=");
                info.params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
            });
        }

        if (iframe.contentWindow && iframe.contentWindow.jsPageID) {
            info.pageId = iframe.contentWindow.jsPageID;
        }
        if (iframe.contentWindow && iframe.contentWindow.document) {
            info.title = iframe.contentWindow.document.title;
        }
    } catch (e) {
        console.warn("Smart Insights: could not read iframe", e.message);
    }
    return info;
}

// ====================================================================
// Response Router: Dispatches to action-specific handlers
// ====================================================================

function processSmartInsightsResponse(responseText, iframe) {
    console.log("Smart Insights: response received", responseText);
    var response;
    try {
        response = JSON.parse(responseText);
    } catch (e) {
        console.warn("Smart Insights: could not parse response", e.message);
        return;
    }

    if (response.status === "error") {
        return;
    }

    // Route by action type
    var action = response.action || "pageInsight";

    switch (action) {
        case "verificationDateCheck":
            handleVerificationDateCheck(response, iframe);
            break;
        case "changeTypeSelection":
            handleChangeTypeSelection(response, iframe);
            break;
        case "pageInsight":
        default:
            handleGenericPageInsight(response, iframe);
            break;
    }
}

// ====================================================================
// Generic Page Insight: Inject HTML after page-header/page-description
// ====================================================================

function handleGenericPageInsight(response, iframe) {
    var iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
    if (!iframeDoc) return;

    var anchorDiv = iframeDoc.querySelector(".page-header")
        || iframeDoc.querySelector(".page-description");
    if (!anchorDiv) return;

    var existingInsights = iframeDoc.getElementById("d2s-smart-insights-container");
    if (existingInsights) {
        existingInsights.innerHTML = response.html;
    } else {
        var container = iframeDoc.createElement("div");
        container.id = "d2s-smart-insights-container";
        container.innerHTML = response.html;
        anchorDiv.parentNode.insertBefore(container, anchorDiv.nextSibling);
    }
}

// ====================================================================
// Priority 1: Verification Date Check — Add Proof Modal
//
// On load:  nothing visible — silently store previous verification data.
// On date change: if mismatch, show tooltip on Date Received field.
// On Save click:  if mismatch, block and show overlay with two options.
// ====================================================================

function handleVerificationDateCheck(response, iframe) {
    var iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
    if (!iframeDoc) {
        console.warn("Smart Insights [AddProof]: No iframeDoc available");
        return;
    }

    console.log("Smart Insights [AddProof]: Response received:",
        "hasPrevious=" + response.hasPreviousVerification,
        "prevDate=" + response.previousDateReceived,
        "utilID=" + response.verificationItemUtilizationID);

    // No previous verification → nothing to do
    if (!response.hasPreviousVerification || !response.previousDateReceived) {
        console.log("Smart Insights [AddProof]: No previous verification — skipping");
        return;
    }

    // Silently store server data — no banner, no save disabled
    iframe.contentWindow._d2sVerificationData = {
        previousDateReceived: response.previousDateReceived,
        verificationItemUtilizationID: response.verificationItemUtilizationID || ""
    };

    // Set up date field tooltip + save interception after form renders
    setupAddProofInterception(iframeDoc, iframe);
}

/**
 * Waits for the form to render, then:
 *  - Watches Date Received field for changes → shows/hides tooltip on mismatch
 *  - Intercepts Save → shows overlay if date doesn't match
 */
function setupAddProofInterception(iframeDoc, iframe) {
    setTimeout(function () {
        var data = iframe.contentWindow._d2sVerificationData;
        if (!data) {
            console.warn("Smart Insights [AddProof]: No verification data stored");
            return;
        }

        // --- Diagnostics: dump all form fields so we can identify the right ones ---
        var allInputs = iframeDoc.querySelectorAll("input, select, textarea");
        console.log("Smart Insights [AddProof]: Found " + allInputs.length + " form fields:");
        for (var d = 0; d < allInputs.length; d++) {
            var inp = allInputs[d];
            console.log("  [" + d + "] tag=" + inp.tagName
                + " type=" + (inp.type || "")
                + " name=" + (inp.name || "")
                + " id=" + (inp.id || "")
                + " class=" + (inp.className || "")
                + " value=" + (inp.value || "").substring(0, 50));
        }

        // --- Diagnostics: dump all buttons/anchors that could be save ---
        var allButtons = iframeDoc.querySelectorAll("button, input[type='submit'], input[type='button'], a");
        console.log("Smart Insights [AddProof]: Found " + allButtons.length + " buttons/links:");
        for (var b = 0; b < allButtons.length; b++) {
            var btn = allButtons[b];
            console.log("  [" + b + "] tag=" + btn.tagName
                + " type=" + (btn.type || "")
                + " id=" + (btn.id || "")
                + " class=" + (btn.className || "")
                + " text=" + (btn.textContent || "").trim().substring(0, 40));
        }

        var dateField = findDateReceivedField(iframeDoc);
        var saveButtons = findAllSaveButtons(iframeDoc);

        console.log("Smart Insights [AddProof]: dateField=" + (dateField ? dateField.name || dateField.id : "NOT FOUND"));
        console.log("Smart Insights [AddProof]: saveButtons=" + saveButtons.length);
        console.log("Smart Insights [AddProof]: previousDate=" + data.previousDateReceived);

        if (!dateField) {
            console.warn("Smart Insights [AddProof]: Date Received field NOT FOUND — check field names above");
            return;
        }
        if (saveButtons.length === 0) {
            console.warn("Smart Insights [AddProof]: Save buttons NOT FOUND — check buttons above");
        }

        var state = { confirmed: false };

        // --- Date field change: show/hide tooltip ---
        function onDateChange() {
            var entered = (dateField.value || "").trim();
            var previous = data.previousDateReceived.trim();
            var matches = entered === previous;
            var empty = entered === "";

            // Reset confirmation when date changes
            state.confirmed = false;

            if (!empty && !matches) {
                // Mismatch — show tooltip on the date field
                showDateTooltip(iframeDoc, dateField, previous);
            } else {
                // Match or empty — remove tooltip
                removeDateTooltip(iframeDoc);
            }
        }

        dateField.addEventListener("change", onDateChange);
        dateField.addEventListener("blur", onDateChange);

        // --- Save interception ---
        function interceptSave(e, retrigger) {
            var entered = (dateField.value || "").trim();
            var previous = data.previousDateReceived.trim();

            // No mismatch, or empty, or already confirmed → allow save
            if (entered === previous || !entered || state.confirmed) return;

            // Block save
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Show overlay
            showDateMismatchOverlay(iframeDoc, previous,
                // Option 1: "Not a correction" → save proceeds
                function () {
                    state.confirmed = true;
                    removeDateTooltip(iframeDoc);
                    retrigger();
                },
                // Option 2: "Is a correction" → go back, fix date
                function () {
                    dateField.focus();
                    showDateTooltip(iframeDoc, dateField, previous);
                }
            );
            return false;
        }

        for (var i = 0; i < saveButtons.length; i++) {
            (function (btn) {
                var origClick = btn.onclick;
                btn.addEventListener("click", function (e) {
                    interceptSave(e, function () {
                        if (origClick) origClick.call(btn, e);
                        else btn.click();
                    });
                }, true);
            })(saveButtons[i]);
        }

        var forms = iframeDoc.querySelectorAll("form");
        for (var j = 0; j < forms.length; j++) {
            (function (frm) {
                frm.addEventListener("submit", function (e) {
                    interceptSave(e, function () { frm.submit(); });
                }, true);
            })(forms[j]);
        }
    }, 500);
}

/**
 * Shows a tooltip message below the Date Received field group when the
 * entered date does not match the previous verification date.
 *
 * The tooltip is placed AFTER the outermost field wrapper (not after
 * the <input> inside the date picker) to avoid overlapping the
 * calendar icon or blocking input.
 */
function showDateTooltip(iframeDoc, dateField, previousDate) {
    removeDateTooltip(iframeDoc);

    // Walk up from the <input> to the outermost field container.
    // Curam wraps date fields in: cds--cluster__item > cds--field >
    // div[curamrenderertype] > cds--date-picker > ... > <input>
    var fieldContainer = dateField.closest(".cds--cluster__item")
        || dateField.closest("[curamrenderertype]")
        || dateField.closest(".cds--field")
        || dateField.closest(".cds--col")
        || dateField.parentNode;

    var tip = iframeDoc.createElement("div");
    tip.id = "d2s-si-date-tooltip";
    tip.style.cssText = "background-color:#fff8e1;border-left:3px solid #f9a825;"
        + "padding:8px 12px;margin:6px 0;border-radius:3px;"
        + "font-size:12px;line-height:1.5;color:#333;clear:both;";
    tip.innerHTML = '&#9888; <strong>Date Received Guidance:</strong> '
        + 'If this verification was raised due to an evidence correction '
        + 'and the same proof is being used, set to the date of receipt '
        + 'for the <em>original</em> proof/document. Do not set to today\u2019s '
        + 'date unless the proof was received today.'
        + '<br/><span style="color:#1565c0;font-weight:bold;">'
        + 'Previous verification Date Received: '
        + escapeHtmlJs(formatDateDisplay(previousDate)) + '</span>';

    // Insert after the field container, not inside it
    fieldContainer.parentNode.insertBefore(tip, fieldContainer.nextSibling);

    // Highlight the input border
    dateField.style.borderColor = "#f9a825";
    dateField.style.borderWidth = "2px";
    dateField.style.boxShadow = "0 0 4px rgba(249, 168, 37, 0.5)";
}

/**
 * Removes the date tooltip and resets field styling.
 */
function removeDateTooltip(iframeDoc) {
    var existing = iframeDoc.getElementById("d2s-si-date-tooltip");
    if (existing) {
        existing.remove();
    }
    // Reset any highlighted date field
    var dateField = findDateReceivedField(iframeDoc);
    if (dateField) {
        dateField.style.borderColor = "";
        dateField.style.borderWidth = "";
        dateField.style.boxShadow = "";
    }
}

function findDateReceivedField(iframeDoc) {
    // Curam uses data-testid="date_Field.Label.DateReceived" on the input,
    // with auto-generated name/id like __o3id1
    return iframeDoc.querySelector('[data-testid*="DateReceived"]')
        || iframeDoc.querySelector('[data-testid*="dateReceived"]')
        || iframeDoc.querySelector('[data-testid*="date_received"]')
        || findFieldByPartialName(iframeDoc, "dateReceived")
        || findFieldByPartialName(iframeDoc, "DateReceived");
}

/**
 * Finds a form field by partial match on name, id, data-testid,
 * or label title. Curam generates opaque IDs (__o3id*) so we check
 * multiple attributes.
 */
function findFieldByPartialName(iframeDoc, partialName) {
    var lower = partialName.toLowerCase();
    var inputs = iframeDoc.querySelectorAll("input, select, textarea");
    for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var searchable = (inp.name || "") + "|" + (inp.id || "") + "|"
            + (inp.getAttribute("data-testid") || "") + "|"
            + (inp.title || "");
        if (searchable.toLowerCase().indexOf(lower) !== -1) {
            return inp;
        }
    }
    return null;
}

/**
 * Finds save buttons. Curam renders modal Save/Cancel in the parent
 * frame's modal footer, NOT inside the iframe. So we search both
 * the iframe document AND the top-level document.
 */
function findAllSaveButtons(iframeDoc) {
    var buttons = [];

    // 1. Check inside the iframe
    var iframeButtons = iframeDoc.querySelectorAll(
        '[data-testid*="Save"], button.cds--btn--primary, '
        + 'button[type="submit"], input[type="submit"]');
    buttons = buttons.concat(Array.prototype.slice.call(iframeButtons));

    // 2. Check the parent/top document (Curam modal footer)
    try {
        var topDoc = document;
        var parentButtons = topDoc.querySelectorAll(
            '[data-testid*="Save"][class*="cds--btn--primary"]');
        if (parentButtons.length === 0) {
            parentButtons = topDoc.querySelectorAll(
                'button.cds--btn--primary');
        }
        buttons = buttons.concat(Array.prototype.slice.call(parentButtons));
    } catch (e) {
        // cross-origin, ignore
    }

    console.log("Smart Insights [AddProof]: Save buttons found: "
        + buttons.length + " (iframe=" + iframeButtons.length + ")");
    return buttons;
}

/**
 * Shows the date mismatch overlay with two radio options:
 *   1. "This is not a correction" → calls onNotACorrection → save proceeds
 *   2. "This is a correction and the original proof Date Received was entered"
 *      → calls onIsACorrection → returns to form, must fix date
 *
 * Back button always returns to the form.
 * Confirm button only enabled after selecting an option.
 * If option 2 is selected, Confirm sends user back (same as Back).
 */
/**
 * Converts a date string from YYYY-MM-DD (or any parseable format)
 * to MM/DD/YYYY for display.
 */
function formatDateDisplay(dateStr) {
    if (!dateStr) return "";
    // If already in M/d/yyyy format, return as-is
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr.trim())) {
        return dateStr.trim();
    }
    try {
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
    } catch (e) {
        return dateStr;
    }
}

function showDateMismatchOverlay(iframeDoc, previousDateReceived,
    onNotACorrection, onIsACorrection) {

    // Use parent document for the overlay — Curam modals live in the
    // parent frame, so overlays must be there too to be visible.
    var targetDoc = document;

    var existing = targetDoc.getElementById("d2s-si-date-confirm-modal");
    if (existing) existing.remove();

    var displayDate = formatDateDisplay(previousDateReceived);

    // Overlay anchored to top of screen, not centered vertically
    var overlay = targetDoc.createElement("div");
    overlay.id = "d2s-si-date-confirm-modal";
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;"
        + "background:rgba(0,0,0,0.6);z-index:99999;display:flex;"
        + "align-items:flex-start;justify-content:center;padding-top:20px;";

    overlay.innerHTML =
        '<div style="background:#fff;border-radius:8px;padding:28px 32px;max-width:560px;'
        + 'width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3);">'

        + '<h3 style="margin:0 0 16px 0;font-size:17px;color:#b71c1c;">'
        + '&#9888; Date Received Verification</h3>'

        + '<p style="font-size:13px;line-height:1.6;color:#333;margin:0 0 12px 0;">'
        + 'The system has determined that this verification may have been raised '
        + 'due to a Correction of an evidence.</p>'

        + '<p style="font-size:13px;line-height:1.6;color:#333;margin:0 0 16px 0;">'
        + 'The previous verification Date Received was: '
        + '<strong style="color:#1565c0;font-size:14px;">'
        + escapeHtmlJs(displayDate) + '</strong></p>'

        + '<p style="font-size:13px;line-height:1.6;color:#333;margin:0 0 8px 0;">'
        + 'Please select one of the following:</p>'

        // Option 1
        + '<label id="d2s-opt1-label" style="display:block;padding:12px 14px;margin:6px 0;'
        + 'border:2px solid #e0e0e0;border-radius:6px;cursor:pointer;font-size:13px;">'
        + '<input type="radio" name="d2s-date-confirm-option" value="notCorrection" '
        + 'style="margin-right:10px;transform:scale(1.2);"/>'
        + '<strong>This is not a correction</strong><br/>'
        + '<span style="margin-left:26px;color:#555;">The date entered is correct. '
        + 'Proceed with saving.</span></label>'

        // Option 2
        + '<label id="d2s-opt2-label" style="display:block;padding:12px 14px;margin:6px 0;'
        + 'border:2px solid #e0e0e0;border-radius:6px;cursor:pointer;font-size:13px;">'
        + '<input type="radio" name="d2s-date-confirm-option" value="isCorrection" '
        + 'style="margin-right:10px;transform:scale(1.2);"/>'
        + '<strong>This is a correction and the original proof Date Received was entered</strong><br/>'
        + '<span style="margin-left:26px;color:#555;">Go back and set the Date Received to '
        + 'the original proof date.</span></label>'

        + '<p style="font-size:13px;line-height:1.6;color:#333;margin:12px 0 20px 0;">'
        + 'Click <strong>Back</strong> to modify details, or <strong>Confirm</strong> '
        + 'after selecting an option.</p>'

        + '<div style="display:flex;justify-content:flex-end;gap:12px;">'
        + '<button id="d2s-date-back-btn" style="background:#fff;color:#333;'
        + 'border:1px solid #999;padding:10px 24px;border-radius:4px;font-size:14px;'
        + 'cursor:pointer;font-weight:500;">Back</button>'
        + '<button id="d2s-date-confirm-btn" disabled style="background:#1a237e;color:#fff;'
        + 'border:none;padding:10px 24px;border-radius:4px;font-size:14px;'
        + 'cursor:pointer;font-weight:500;opacity:0.4;">Confirm</button>'
        + '</div></div>';

    targetDoc.body.appendChild(overlay);

    // Enable Confirm when a radio is selected + highlight label
    var radios = overlay.querySelectorAll('input[name="d2s-date-confirm-option"]');
    var confirmBtn = targetDoc.getElementById("d2s-date-confirm-btn");
    var labels = overlay.querySelectorAll("label");

    for (var r = 0; r < radios.length; r++) {
        radios[r].addEventListener("change", function () {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = "1";
            for (var l = 0; l < labels.length; l++) {
                labels[l].style.borderColor = "#e0e0e0";
                labels[l].style.backgroundColor = "#fff";
            }
            this.closest("label").style.borderColor = "#1a237e";
            this.closest("label").style.backgroundColor = "#e8eaf6";
        });
    }

    // Back → always return to form
    targetDoc.getElementById("d2s-date-back-btn").addEventListener("click", function () {
        overlay.remove();
        if (onIsACorrection) onIsACorrection();
    });

    // Confirm → depends on which option was selected
    confirmBtn.addEventListener("click", function () {
        var selected = overlay.querySelector('input[name="d2s-date-confirm-option"]:checked');
        if (!selected) return;

        overlay.remove();

        if (selected.value === "notCorrection") {
            // Option 1: not a correction → save proceeds
            if (onNotACorrection) onNotACorrection();
        } else {
            // Option 2: is a correction → go back, fix the date
            if (onIsACorrection) onIsACorrection();
        }
    });
}

function escapeHtmlJs(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ====================================================================
// Priority 2: Change Type Selection — Edit Evidence Modal
// ====================================================================

function handleChangeTypeSelection(response, iframe) {
    var iframeDoc = iframe.contentWindow && iframe.contentWindow.document;
    if (!iframeDoc) return;

    // Store validation rules
    if (response.validationRules) {
        iframe.contentWindow.d2sValidationRules = response.validationRules;
    }

    // Inject the change type overlay into the top-level document
    // (Curam modals live in the parent frame, not the iframe)
    var targetDoc = document;
    var container = targetDoc.createElement("div");
    container.innerHTML = response.html;
    targetDoc.body.appendChild(container.firstChild);

    // After user selects change type and clicks Continue, set up validation
    setupChangeTypeValidation(iframeDoc, iframe, targetDoc);
}

/**
 * Monitors for the change type overlay to be dismissed,
 * then captures original field values and sets up save validation.
 */
function setupChangeTypeValidation(iframeDoc, iframe, targetDoc) {
    var checkInterval = setInterval(function () {
        var overlay = targetDoc.getElementById("d2s-si-change-type-overlay")
            || iframeDoc.getElementById("d2s-si-change-type-overlay");
        if (!overlay) {
            clearInterval(checkInterval);

            // d2sSelectedChangeType is set by the overlay's Continue onclick
            // which uses window. — check both frames
            var selectedType = window.d2sSelectedChangeType
                || (iframe.contentWindow && iframe.contentWindow.d2sSelectedChangeType);
            if (!selectedType) return;

            console.log("Smart Insights [EditEvidence]: Change type selected:", selectedType);

            // Snapshot original field values
            var originalValues = captureFieldValues(iframeDoc);

            // Show guidance banner
            showChangeTypeGuidance(iframeDoc, selectedType);

            // Set up save-time validation
            setupEditEvidenceSaveValidation(iframeDoc, iframe, selectedType, originalValues);
        }
    }, 200);

    setTimeout(function () { clearInterval(checkInterval); }, 60000);
}

/**
 * Captures original date field values from the evidence edit form.
 * Uses data-testid selectors (Curam pattern).
 */
function captureFieldValues(iframeDoc) {
    var values = {};

    var effectiveDate = findEvidenceDateField(iframeDoc, "EffectiveDate");
    var startDate = findEvidenceDateField(iframeDoc, "StartDate");
    var endDate = findEvidenceDateField(iframeDoc, "EndDate");

    if (effectiveDate) values.effectiveDate = effectiveDate.value;
    if (startDate) values.startDate = startDate.value;
    if (endDate) values.endDate = endDate.value;

    console.log("Smart Insights [EditEvidence]: Original values:", JSON.stringify(values));

    // Diagnostic: list all date fields found
    var allDateFields = iframeDoc.querySelectorAll('[data-testid*="date_"], [data-testid*="Date"]');
    console.log("Smart Insights [EditEvidence]: Date fields on page: " + allDateFields.length);
    for (var i = 0; i < allDateFields.length; i++) {
        console.log("  [" + i + "] testid=" + allDateFields[i].getAttribute("data-testid")
            + " value=" + (allDateFields[i].value || ""));
    }

    return values;
}

/**
 * Finds an evidence date field by searching data-testid for partial match.
 * Curam uses data-testid="date_Field.Label.EffectiveDate" etc.
 */
function findEvidenceDateField(iframeDoc, fieldName) {
    return iframeDoc.querySelector('[data-testid*="' + fieldName + '"]')
        || findFieldByPartialName(iframeDoc, fieldName);
}

/**
 * Shows a guidance banner at the top of the form indicating selected change type.
 */
function showChangeTypeGuidance(iframeDoc, selectedType) {
    var labels = {
        ending: "Ending the Evidence",
        changeOverTime: "Change over Time",
        correction: "Correction"
    };

    var colors = {
        ending: { bg: "#fce4ec", border: "#c62828", text: "#b71c1c" },
        changeOverTime: { bg: "#e3f2fd", border: "#1565c0", text: "#0d47a1" },
        correction: { bg: "#fff3e0", border: "#e65100", text: "#bf360c" }
    };

    var c = colors[selectedType] || colors.correction;

    var guidanceHtml = '<div id="d2s-si-change-type-guidance" '
        + 'style="background-color:' + c.bg + ';border-left:4px solid ' + c.border + ';'
        + 'padding:10px 14px;margin:8px 0;border-radius:4px;font-size:13px;">'
        + '<strong style="color:' + c.text + ';">Change Type: '
        + labels[selectedType] + '</strong>'
        + ' &mdash; Date validations will be enforced based on your selection.'
        + '</div>';

    // Try iframe first, then parent doc
    var formArea = iframeDoc.querySelector(".modal-content")
        || iframeDoc.querySelector("form")
        || iframeDoc.querySelector(".page-content")
        || iframeDoc.body;

    if (formArea) {
        var container = iframeDoc.createElement("div");
        container.innerHTML = guidanceHtml;
        if (formArea.firstChild) {
            formArea.insertBefore(container, formArea.firstChild);
        } else {
            formArea.appendChild(container);
        }
    }
}

/**
 * Sets up save-time validation for the Edit Evidence form.
 * Uses findAllSaveButtons (searches both iframe and parent doc).
 */
function setupEditEvidenceSaveValidation(iframeDoc, iframe, changeType, originalValues) {
    var rules = iframe.contentWindow.d2sValidationRules;
    if (!rules || !rules[changeType]) return;

    var typeRules = rules[changeType];
    var saveButtons = findAllSaveButtons(iframeDoc);

    console.log("Smart Insights [EditEvidence]: Save buttons for validation: " + saveButtons.length);

    for (var i = 0; i < saveButtons.length; i++) {
        attachEvidenceValidation(saveButtons[i], iframeDoc, typeRules, originalValues);
    }

    var forms = iframeDoc.querySelectorAll("form");
    for (var j = 0; j < forms.length; j++) {
        forms[j].addEventListener("submit", function (e) {
            var errors = validateEvidenceFields(iframeDoc, typeRules, originalValues);
            if (errors.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                showValidationErrors(iframeDoc, errors);
                showFieldErrorTooltips(iframeDoc, errors);
            } else {
                clearFieldErrorTooltips(iframeDoc);
            }
        }, true);
    }
}

/**
 * Attaches validation to a save button click.
 */
function attachEvidenceValidation(button, iframeDoc, typeRules, originalValues) {
    button.addEventListener("click", function (e) {
        var errors = validateEvidenceFields(iframeDoc, typeRules, originalValues);
        if (errors.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showValidationErrors(iframeDoc, errors);
            showFieldErrorTooltips(iframeDoc, errors);
            return false;
        } else {
            clearFieldErrorTooltips(iframeDoc);
        }
    }, true);
}

/**
 * Validates evidence date fields against rules for the selected change type.
 * Returns an array of error objects: { message, field } so callers can
 * show both a top-level error banner and inline tooltips per field.
 */
function validateEvidenceFields(iframeDoc, typeRules, originalValues) {
    var errors = [];

    var effectiveDate = findEvidenceDateField(iframeDoc, "EffectiveDate");
    var startDate = findEvidenceDateField(iframeDoc, "StartDate");
    var endDate = findEvidenceDateField(iframeDoc, "EndDate");

    // Effective Date locked: must not change from original
    if (typeRules.effectiveDateLocked && effectiveDate) {
        if (effectiveDate.value !== (originalValues.effectiveDate || "")) {
            errors.push({
                message: typeRules.effectiveDateError
                    || "The Effective Date must not be changed.",
                field: effectiveDate
            });
        }
    }

    // Effective Date required: must not be empty
    if (typeRules.effectiveDateRequired && effectiveDate) {
        if (!effectiveDate.value || effectiveDate.value.trim() === "") {
            errors.push({
                message: typeRules.effectiveDateError
                    || "The Effective Date must be set.",
                field: effectiveDate
            });
        }
    }

    // Start Date locked: must not change from original
    if (typeRules.startDateLocked && startDate) {
        if (startDate.value !== (originalValues.startDate || "")) {
            errors.push({
                message: typeRules.startDateError
                    || "The Start Date must not be changed.",
                field: startDate
            });
        }
    }

    // End Date must be empty
    if (typeRules.endDateMustBeEmpty && endDate) {
        if (endDate.value && endDate.value.trim() !== "") {
            errors.push({
                message: typeRules.endDateError
                    || "The End Date must not be populated.",
                field: endDate
            });
        }
    }

    return errors;
}

/**
 * Displays validation errors at the top of the form.
 * errors is an array of { message, field } objects.
 */
function showValidationErrors(iframeDoc, errors) {
    var existing = iframeDoc.getElementById("d2s-si-validation-errors");
    if (existing) existing.remove();

    var html = '<div id="d2s-si-validation-errors" '
        + 'style="background-color:#ffebee;border-left:4px solid #c62828;'
        + 'padding:12px 16px;margin:8px 0;border-radius:4px;font-size:13px;">'
        + '<strong style="color:#b71c1c;">&#10060; Validation Errors</strong>'
        + '<ul style="margin:8px 0 0 0;padding-left:20px;">';

    for (var i = 0; i < errors.length; i++) {
        html += '<li style="color:#c62828;margin:4px 0;">' + errors[i].message + '</li>';
    }

    html += '</ul></div>';

    var formArea = iframeDoc.querySelector(".modal-content")
        || iframeDoc.querySelector("form")
        || iframeDoc.querySelector(".page-content")
        || iframeDoc.body;

    if (formArea) {
        var container = iframeDoc.createElement("div");
        container.innerHTML = html;
        if (formArea.firstChild) {
            formArea.insertBefore(container, formArea.firstChild);
        } else {
            formArea.appendChild(container);
        }
        container.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

/**
 * Shows an inline error tooltip below each failing date field.
 * Uses the same container-walking approach as showDateTooltip to
 * avoid overlapping the Curam date picker widget.
 */
function showFieldErrorTooltips(iframeDoc, errors) {
    clearFieldErrorTooltips(iframeDoc);

    for (var i = 0; i < errors.length; i++) {
        var err = errors[i];
        if (!err.field) continue;

        var fieldContainer = err.field.closest(".cds--cluster__item")
            || err.field.closest("[curamrenderertype]")
            || err.field.closest(".cds--field")
            || err.field.closest(".cds--col")
            || err.field.parentNode;

        var tip = iframeDoc.createElement("div");
        tip.className = "d2s-si-field-error-tooltip";
        tip.style.cssText = "background-color:#ffebee;border-left:3px solid #c62828;"
            + "padding:4px 10px;margin:4px 0;border-radius:3px;"
            + "font-size:12px;line-height:1.4;color:#c62828;clear:both;";
        tip.innerHTML = "&#10060; " + err.message;

        fieldContainer.parentNode.insertBefore(tip, fieldContainer.nextSibling);

        // Highlight the input border red
        err.field.style.borderColor = "#c62828";
        err.field.style.borderWidth = "2px";
        err.field.style.boxShadow = "0 0 4px rgba(198, 40, 40, 0.4)";
    }
}

/**
 * Removes all inline field error tooltips and resets field styling.
 */
function clearFieldErrorTooltips(iframeDoc) {
    var tips = iframeDoc.querySelectorAll(".d2s-si-field-error-tooltip");
    for (var i = 0; i < tips.length; i++) {
        tips[i].remove();
    }
    // Reset any red-highlighted fields
    var highlighted = iframeDoc.querySelectorAll(
        '[style*="border-color: rgb(198, 40, 40)"], [style*="border-color:#c62828"]');
    for (var j = 0; j < highlighted.length; j++) {
        highlighted[j].style.borderColor = "";
        highlighted[j].style.borderWidth = "";
        highlighted[j].style.boxShadow = "";
    }
}

// ====================================================================
// Trigger: Build inputJSON and call D2SSmartInsightsPage.do
// ====================================================================

function triggerSmartInsights(pageInfo, iframe) {
    var inputJSON = {
        baseURL: jsBaseURL || "",
        locale: jsL || "",
        pageId: pageInfo.pageId || "",
        params: pageInfo.params || {},
        title: pageInfo.title || "",
        username: getHiddenInputValue("d2s.user.userName"),
        rolename: getHiddenInputValue("d2s.user.rolename"),
        locationID: getHiddenInputValue("d2s.user.locationID"),
        locationName: getHiddenInputValue("d2s.user.locationName")
    };

    var baseUrl = jsBaseURL + "/" + jsL + "/";
    var url = baseUrl + "D2SSmartInsightsPage.do?inputJSON=" + encodeURIComponent(JSON.stringify(inputJSON));

    console.log("Calling Smart Insights API: ", url);

    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                processSmartInsightsResponse(xhr.responseText, iframe);
            } else {
                console.warn("Smart Insights: request failed with status", xhr.status);
            }
        }
    };
    xhr.send();
}

// ====================================================================
// Dojo Event Listeners — Register on DOM ready
// ====================================================================

require(["dojo/ready", "dojo/topic"], function (ready, topic) {
    ready(function () {

        // Fires every time ANY content panel iframe finishes loading.
        // Covers all navigation: section tabs, person tabs, sub-tabs,
        // Person Search, Referrals, Care & Protection.
        topic.subscribe("/curam/main-content/page/loaded", function (pageID, tabWidgetId, tabWidget) {
            var iframe = curam.tab.getContentPanelIframe(tabWidget);
            var pageInfo = iframe ? getPageInfo(iframe) : { pageId: pageID };
            pageInfo.tabWidgetId = tabWidgetId;
            console.log("Smart Insights [main-content-loaded]:", pageInfo);
            triggerSmartInsights(pageInfo, iframe);
        });

        // Fires when a modal dialog is displayed (e.g. Add Proof, Edit Evidence).
        topic.subscribe("/curam/dialog/displayed", function (dialogId) {
            var iframe = document.getElementById("iframe-" + dialogId);
            if (!iframe) {
                return;
            }
            var pageInfo = getPageInfo(iframe);
            console.log("Smart Insights [modal-displayed]:", dialogId, pageInfo);
            triggerSmartInsights(pageInfo, iframe);
        });

        // Section-level tab switch (Home, Cases, Inbox, Calendar)
        topic.subscribe(curam.tab.SECTION_TAB_CONTAINER_ID + "-selectChild", function (child) {
            console.log("Smart Insights [section-changed]:", child.id);
        });

        console.log("Smart Insights: all listeners registered");
    });
});
