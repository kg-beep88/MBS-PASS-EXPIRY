(() => {
  "use strict";

  const CONFIG = window.KG_EXPIRY_CONFIG || {};
  const SCRIPT_URL = String(CONFIG.SCRIPT_URL || "").trim();
  const PLACEHOLDER_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15000;

  const state = {
    pin: sessionStorage.getItem("kgExpiryPin") || localStorage.getItem("kgExpiryPin") || "",
    records: [],
    pendingRequests: new Map(),
    toastTimer: null
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    registerServiceWorker();

    if (!isConfigured()) {
      els.setupNotice.classList.remove("hidden");
      els.unlockPanel.classList.remove("hidden");
      els.pinInput.disabled = true;
      els.unlockForm.querySelector("button").disabled = true;
      return;
    }

    if (state.pin) {
      openApp();
    } else {
      els.unlockPanel.classList.remove("hidden");
      els.pinInput.focus();
    }
  }

  function cacheElements() {
    [
      "setupNotice", "connectionNotice", "unlockPanel", "unlockForm", "pinInput", "rememberPin",
      "appContent", "refreshButton", "addButton", "totalCount", "expiredCount", "urgentCount",
      "upcomingCount", "urgentBadge", "upcomingBadge", "urgentList", "upcomingList", "lastUpdated",
      "searchInput", "statusFilter", "recordsBody", "emptyState", "lockButton", "recordDialog",
      "recordForm", "recordId", "dialogTitle", "nameInput", "companyInput", "expiryInput", "notesInput",
      "closeDialogButton", "cancelDialogButton", "saveButton", "toast"
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.unlockForm.addEventListener("submit", handleUnlock);
    els.refreshButton.addEventListener("click", () => loadRecords(true));
    els.addButton.addEventListener("click", () => openRecordDialog());
    els.searchInput.addEventListener("input", renderRecords);
    els.statusFilter.addEventListener("change", renderRecords);
    els.lockButton.addEventListener("click", lockApp);
    els.closeDialogButton.addEventListener("click", closeRecordDialog);
    els.cancelDialogButton.addEventListener("click", closeRecordDialog);
    els.recordForm.addEventListener("submit", saveRecord);
    els.recordsBody.addEventListener("click", handleTableAction);
    window.addEventListener("message", handleBackendMessage);
  }

  function isConfigured() {
    return SCRIPT_URL && SCRIPT_URL !== PLACEHOLDER_URL && /^https:\/\/script\.google\.com\//i.test(SCRIPT_URL);
  }

  function handleUnlock(event) {
    event.preventDefault();
    const pin = els.pinInput.value.trim();
    if (!pin) return;

    state.pin = pin;
    sessionStorage.setItem("kgExpiryPin", pin);
    if (els.rememberPin.checked) {
      localStorage.setItem("kgExpiryPin", pin);
    } else {
      localStorage.removeItem("kgExpiryPin");
    }
    openApp();
  }

  function openApp() {
    els.unlockPanel.classList.add("hidden");
    els.appContent.classList.remove("hidden");
    loadRecords(false);
  }

  function lockApp() {
    state.pin = "";
    state.records = [];
    sessionStorage.removeItem("kgExpiryPin");
    localStorage.removeItem("kgExpiryPin");
    els.pinInput.value = "";
    els.appContent.classList.add("hidden");
    els.unlockPanel.classList.remove("hidden");
    els.connectionNotice.classList.add("hidden");
    els.pinInput.focus();
  }

  function loadRecords(showSuccessToast) {
    setLoading(true);
    hideConnectionError();

    const callbackName = `kgExpiryCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      setLoading(false);
      showConnectionError("Could not contact the Google Apps Script. Check the deployment URL and access setting.");
    }, REQUEST_TIMEOUT_MS);

    function cleanup() {
      window.clearTimeout(timeout);
      script.remove();
      try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
    }

    window[callbackName] = (response) => {
      cleanup();
      setLoading(false);

      if (!response || response.ok !== true) {
        const message = response?.error || "Unable to load records.";
        if (/pin|unauthor/i.test(message)) {
          lockApp();
          showToast("Incorrect PIN. Please try again.", true);
        } else {
          showConnectionError(message);
        }
        return;
      }

      state.records = Array.isArray(response.records) ? response.records.map(normalizeRecord) : [];
      state.records.sort(sortByExpiryThenName);
      renderAll();
      els.lastUpdated.textContent = `Updated ${formatDateTime(new Date())}`;
      if (showSuccessToast) showToast("List refreshed.");
    };

    const url = new URL(SCRIPT_URL);
    url.searchParams.set("action", "list");
    url.searchParams.set("pin", state.pin);
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("_", String(Date.now()));
    script.src = url.toString();
    script.onerror = () => {
      cleanup();
      setLoading(false);
      showConnectionError("The tracker could not load data. Confirm that the Apps Script deployment is set to Anyone.");
    };
    document.body.appendChild(script);
  }

  function normalizeRecord(record) {
    return {
      id: String(record.id || ""),
      name: String(record.name || "").trim(),
      company: String(record.company || "").trim(),
      expiryDate: String(record.expiryDate || "").slice(0, 10),
      notes: String(record.notes || "").trim(),
      updatedAt: String(record.updatedAt || "")
    };
  }

  function renderAll() {
    renderSummary();
    renderPinnedAlerts();
    renderRecords();
  }

  function renderSummary() {
    const statuses = state.records.map(getStatus);
    els.totalCount.textContent = state.records.length;
    els.expiredCount.textContent = statuses.filter((s) => s.key === "expired").length;
    els.urgentCount.textContent = statuses.filter((s) => s.key === "urgent").length;
    els.upcomingCount.textContent = statuses.filter((s) => s.key === "upcoming").length;
  }

  function renderPinnedAlerts() {
    const redRecords = state.records.filter((record) => {
      const key = getStatus(record).key;
      return key === "expired" || key === "urgent";
    });
    const yellowRecords = state.records.filter((record) => getStatus(record).key === "upcoming");

    els.urgentBadge.textContent = redRecords.length;
    els.upcomingBadge.textContent = yellowRecords.length;
    renderAlertList(els.urgentList, redRecords, "No expired passes or passes due within 15 days.");
    renderAlertList(els.upcomingList, yellowRecords, "No passes due in 16–30 days.");
  }

  function renderAlertList(container, records, emptyMessage) {
    container.replaceChildren();
    if (records.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-panel";
      empty.textContent = emptyMessage;
      container.appendChild(empty);
      return;
    }

    records.forEach((record) => {
      const status = getStatus(record);
      const item = document.createElement("div");
      item.className = "alert-item";

      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = record.name;
      const detail = document.createElement("span");
      detail.textContent = `${record.company} · ${formatDate(record.expiryDate)}`;
      info.append(name, detail);

      const days = document.createElement("span");
      days.className = "days-label";
      days.textContent = status.shortLabel;

      item.append(info, days);
      container.appendChild(item);
    });
  }

  function renderRecords() {
    const query = els.searchInput.value.trim().toLowerCase();
    const filter = els.statusFilter.value;
    const records = state.records.filter((record) => {
      const matchesText = !query || `${record.name} ${record.company} ${record.notes}`.toLowerCase().includes(query);
      const status = getStatus(record).key;
      const matchesFilter = filter === "all" || filter === status;
      return matchesText && matchesFilter;
    });

    els.recordsBody.replaceChildren();
    els.emptyState.classList.toggle("hidden", records.length > 0);

    records.forEach((record) => {
      const status = getStatus(record);
      const row = document.createElement("tr");
      row.className = `row-${status.key}`;
      row.dataset.id = record.id;

      const nameCell = document.createElement("td");
      nameCell.className = "name-cell";
      const name = document.createElement("strong");
      name.textContent = record.name;
      nameCell.appendChild(name);
      if (record.notes) {
        const notes = document.createElement("small");
        notes.textContent = record.notes;
        nameCell.appendChild(notes);
      }

      const companyCell = document.createElement("td");
      companyCell.textContent = record.company;

      const expiryCell = document.createElement("td");
      expiryCell.textContent = formatDate(record.expiryDate);

      const statusCell = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = `status-pill status-${status.key}`;
      pill.textContent = status.label;
      statusCell.appendChild(pill);

      const actionCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "row-actions";
      actions.innerHTML = `
        <button class="small-button" type="button" data-action="edit">Edit</button>
        <button class="small-button delete" type="button" data-action="delete">Delete</button>
      `;
      actionCell.appendChild(actions);

      row.append(nameCell, companyCell, expiryCell, statusCell, actionCell);
      els.recordsBody.appendChild(row);
    });
  }

  function handleTableAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const row = button.closest("tr[data-id]");
    const record = state.records.find((item) => item.id === row?.dataset.id);
    if (!record) return;

    if (button.dataset.action === "edit") {
      openRecordDialog(record);
    } else if (button.dataset.action === "delete") {
      deleteRecord(record);
    }
  }

  function openRecordDialog(record = null) {
    els.recordForm.reset();
    els.recordId.value = record?.id || "";
    els.dialogTitle.textContent = record ? "Edit person" : "Add person";
    els.nameInput.value = record?.name || "";
    els.companyInput.value = record?.company || "";
    els.expiryInput.value = record?.expiryDate || "";
    els.notesInput.value = record?.notes || "";
    els.recordDialog.showModal();
    window.setTimeout(() => els.nameInput.focus(), 0);
  }

  function closeRecordDialog() {
    if (els.recordDialog.open) els.recordDialog.close();
  }

  function saveRecord(event) {
    event.preventDefault();
    if (!els.recordForm.reportValidity()) return;

    const id = els.recordId.value.trim();
    const payload = {
      action: id ? "update" : "create",
      id,
      name: els.nameInput.value.trim(),
      company: els.companyInput.value.trim(),
      expiryDate: els.expiryInput.value,
      notes: els.notesInput.value.trim()
    };

    els.saveButton.disabled = true;
    els.saveButton.textContent = "Saving…";
    postToBackend(payload)
      .then(() => {
        closeRecordDialog();
        showToast(id ? "Record updated." : "Record added.");
        loadRecords(false);
      })
      .catch((error) => showToast(error.message || "Unable to save record.", true))
      .finally(() => {
        els.saveButton.disabled = false;
        els.saveButton.textContent = "Save record";
      });
  }

  async function deleteRecord(record) {
    const confirmed = window.confirm(`Delete ${record.name} from the expiry list?`);
    if (!confirmed) return;

    try {
      await postToBackend({ action: "delete", id: record.id });
      showToast("Record deleted.");
      loadRecords(false);
    } catch (error) {
      showToast(error.message || "Unable to delete record.", true);
    }
  }

  function postToBackend(values) {
    return new Promise((resolve, reject) => {
      const callbackName = `kgExpirySave_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("The save request timed out. Confirm the latest Apps Script version is deployed."));
      }, REQUEST_TIMEOUT_MS);

      function cleanup() {
        window.clearTimeout(timeout);
        script.remove();
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      }

      window[callbackName] = (response) => {
        cleanup();
        if (!response || response.ok !== true) {
          reject(new Error(response?.error || "Unable to save record."));
          return;
        }
        resolve(response.result || null);
      };

      const url = new URL(SCRIPT_URL);
      const data = { ...values, pin: state.pin, callback: callbackName, _: String(Date.now()) };
      Object.entries(data).forEach(([name, value]) => {
        url.searchParams.set(name, value == null ? "" : String(value));
      });

      script.src = url.toString();
      script.onerror = () => {
        cleanup();
        reject(new Error("The save request could not reach Apps Script. Check the /exec URL and deployment access."));
      };
      document.body.appendChild(script);
    });
  }

  function handleBackendMessage(event) {
    const data = event.data;
    if (!data || data.source !== "kg-expiry-backend" || !data.requestId) return;
    const pending = state.pendingRequests.get(data.requestId);
    if (!pending) return;

    window.clearTimeout(pending.timeout);
    state.pendingRequests.delete(data.requestId);
    if (data.ok) pending.resolve(data);
    else pending.reject(new Error(data.error || "Backend request failed."));
  }

  function getStatus(record) {
    const days = daysUntil(record.expiryDate);
    if (!Number.isFinite(days)) return { key: "safe", label: "Date error", shortLabel: "Check date", days };
    if (days < 0) {
      const overdue = Math.abs(days);
      return { key: "expired", label: `Expired ${overdue} day${overdue === 1 ? "" : "s"} ago`, shortLabel: `${overdue}d overdue`, days };
    }
    if (days <= 15) {
      return { key: "urgent", label: days === 0 ? "Expires today" : `${days} day${days === 1 ? "" : "s"} left`, shortLabel: days === 0 ? "Today" : `${days}d left`, days };
    }
    if (days <= 30) {
      return { key: "upcoming", label: `${days} days left`, shortLabel: `${days}d left`, days };
    }
    return { key: "safe", label: `${days} days left`, shortLabel: `${days}d left`, days };
  }

  function daysUntil(dateString) {
    const expiry = parseLocalDate(dateString);
    if (!expiry) return NaN;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((expiry.getTime() - today.getTime()) / MS_PER_DAY);
  }

  function parseLocalDate(dateString) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(dateString) {
    const date = parseLocalDate(dateString);
    if (!date) return "Invalid date";
    return new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function formatDateTime(date) {
    return new Intl.DateTimeFormat("en-SG", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function sortByExpiryThenName(a, b) {
    const dateCompare = a.expiryDate.localeCompare(b.expiryDate);
    return dateCompare || a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  }

  function setLoading(loading) {
    els.refreshButton.disabled = loading;
    els.refreshButton.textContent = loading ? "Loading…" : "Refresh";
  }

  function showConnectionError(message) {
    els.connectionNotice.textContent = message;
    els.connectionNotice.classList.remove("hidden");
  }

  function hideConnectionError() {
    els.connectionNotice.classList.add("hidden");
  }

  function showToast(message, isError = false) {
    window.clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.toggle("error", isError);
    els.toast.classList.remove("hidden");
    state.toastTimer = window.setTimeout(() => els.toast.classList.add("hidden"), 3500);
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }
})();
