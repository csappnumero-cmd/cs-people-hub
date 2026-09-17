const API_URL = "https://script.google.com/macros/s/AKfycbzYwh_6I2iQXgxujpWuRzCflOKelTaqSoqI4eML9cQF7QNZ3O4jBcy28ffvXZV5amGK/exec";

const state = {
  data: null,
  employees: [],
  sortMode: "CUSTOM"
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindEvents();
  loadData();
}

function bindEvents() {
  $("#refreshBtn").addEventListener("click", () => loadData(true));

  ["searchInput","titleFilter","teamFilter","managerFilter","statusFilter"].forEach(id => {
    const el = $("#" + id);
    el.addEventListener(id === "searchInput" ? "input" : "change", renderEmployees);
  });

  $("#clearBtn").addEventListener("click", () => {
    $("#searchInput").value = "";
    $("#titleFilter").value = "";
    $("#teamFilter").value = "";
    $("#managerFilter").value = "";
    $("#statusFilter").value = "ACTIVE";
    setHireSort("CUSTOM");
    renderEmployees();
  });

  $("#hireSortBtn").addEventListener("click", () => {
    const mode = state.sortMode;
    const next = mode === "CUSTOM" ? "HIRE_ASC" : mode === "HIRE_ASC" ? "HIRE_DESC" : "CUSTOM";
    setHireSort(next);
    renderEmployees();
  });

  $("#employeeGrid").addEventListener("click", event => {
    const button = event.target.closest("[data-employee-index]");
    if (!button) return;
    const employee = state.employees[Number(button.dataset.employeeIndex)];
    if (employee) openEmployee(employee);
  });

  $("#orgButton").addEventListener("click", openOrgModal);
  $("#backdrop").addEventListener("click", closeModals);

  $$("[data-close]").forEach(button => button.addEventListener("click", closeModals));

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModals();
  });
}

async function loadData(manual = false) {
  setLoading(true);

  try {
    const url = API_URL + (API_URL.includes("?") ? "&" : "?") + "_=" + Date.now();
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow"
    });

    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const data = await response.json();

    if (!data || data.success !== true || !Array.isArray(data.employees)) {
      throw new Error("Unexpected API response.");
    }

    state.data = data;
    state.employees = data.employees.slice();

    applySettings();
    buildFilters();
    updateSummary();
    renderEmployees();

    if (manual) toast("Data refreshed");
  } catch (error) {
    console.error(error);
    showLoadError(error);
  } finally {
    setLoading(false);
  }
}

function applySettings() {
  const settings = state.data?.settings || {};

  if (settings.primaryColor) {
    document.documentElement.style.setProperty("--primary", settings.primaryColor);
  }
  if (settings.accentColor) {
    document.documentElement.style.setProperty("--accent", settings.accentColor);
  }

  $("#companyName").textContent = settings.companyName || "Customer Support";

  const logoUrl = safeUrl(settings.logoUrl) || "https://i.imgur.com/sksZ1Hq.jpg";
  $("#brandLogo").src = logoUrl;
  $("#orgButtonLogo").src = logoUrl;

  const orgUrl = safeUrl(settings.orgImageUrl);
  const orgImage = $("#orgImage");
  const fallback = $("#orgImageFallback");

  if (!orgUrl) {
    orgImage.classList.add("hidden");
    fallback.classList.remove("hidden");
  } else {
    orgImage.onload = () => {
      orgImage.classList.remove("hidden");
      fallback.classList.add("hidden");
    };
    orgImage.onerror = () => {
      orgImage.classList.add("hidden");
      fallback.classList.remove("hidden");
    };
    orgImage.src = orgUrl;
  }
}

function updateSummary() {
  // Summary cards count ACTIVE employees only.
  // Which job titles belong to each card is controlled from the Settings sheet.
  const active = state.employees.filter(e => normalizeStatus(e.status) === "ACTIVE");
  const settings = state.data?.settings || {};
  const groups = settings.summaryGroups || {};

  const countGroup = rules => active.filter(employee =>
    titleMatchesAny(employee.jobTitle, Array.isArray(rules) ? rules : [])
  ).length;

  $("#sumTotal").textContent = state.employees.length;
  $("#sumActive").textContent =
    `${active.length} active · ${state.employees.length - active.length} inactive`;

  $("#sumManagement").textContent = countGroup(groups.management);
  $("#sumQA").textContent = countGroup(groups.quality);
  $("#sumLeaders").textContent = countGroup(groups.teamLeaders);
  $("#sumSupervisors").textContent = countGroup(groups.supervisors);
  $("#sumAgents").textContent = countGroup(groups.supportTeam);
}

function titleMatchesAny(jobTitle, rules) {
  const title = String(jobTitle || "").trim().toLowerCase();
  if (!title) return false;

  return rules.some(rule => {
    const raw = String(rule || "").trim().toLowerCase();
    if (!raw) return false;

    // Optional wildcard support: *Team Leader* matches any title containing Team Leader.
    if (raw.startsWith("*") && raw.endsWith("*") && raw.length > 2) {
      return title.includes(raw.slice(1, -1));
    }
    if (raw.startsWith("*") && raw.length > 1) {
      return title.endsWith(raw.slice(1));
    }
    if (raw.endsWith("*") && raw.length > 1) {
      return title.startsWith(raw.slice(0, -1));
    }

    return title === raw;
  });
}

function buildFilters() {
  populateSelect(
    "#titleFilter",
    "All job titles",
    unique(state.employees.map(e => e.jobTitle).filter(Boolean))
  );

  populateSelect(
    "#teamFilter",
    "All teams",
    unique(state.employees.map(e => e.team).filter(Boolean))
  );

  populateSelect(
    "#managerFilter",
    "All managers",
    unique(state.employees.map(e => e.directManager || e.manager).filter(Boolean))
  );
}

function populateSelect(selector, label, values) {
  const el = $(selector);
  const current = el.value;
  const sorted = values.slice().sort((a,b) => String(a).localeCompare(String(b)));

  el.innerHTML =
    `<option value="">${escapeHtml(label)}</option>` +
    sorted.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");

  if (sorted.includes(current)) el.value = current;
}

function renderEmployees() {
  const search = $("#searchInput").value.trim().toLowerCase();
  const title = $("#titleFilter").value;
  const team = $("#teamFilter").value;
  const manager = $("#managerFilter").value;
  const status = $("#statusFilter").value;

  let rows = state.employees
    .map((employee, originalIndex) => ({ employee, originalIndex }))
    .filter(({ employee:e }) => {
      const haystack = [
        e.name,e.jobTitle,e.team,e.directManager,e.functionalReportingTo,e.email,e.location,e.hireDate,e.notes
      ].join(" ").toLowerCase();

      return (!search || haystack.includes(search))
        && (!title || e.jobTitle === title)
        && (!team || e.team === team)
        && (!manager || (e.directManager || e.manager) === manager)
        && (status === "ALL" || normalizeStatus(e.status) === status);
    });

  sortRows(rows);

  $("#resultCount").textContent = `${rows.length} employee${rows.length === 1 ? "" : "s"}`;
  $("#emptyState").classList.toggle("hidden", rows.length > 0);

  $("#employeeGrid").innerHTML = rows.map(({employee:e,originalIndex}) => employeeCard(e, originalIndex)).join("");
}

function sortRows(rows) {
  const name = value => String(value || "").toLocaleLowerCase();
  const dateValue = value => {
    const stamp = Date.parse(value || "");
    return Number.isNaN(stamp) ? null : stamp;
  };

  rows.sort((a,b) => {
    const ea = a.employee;
    const eb = b.employee;

    if (state.sortMode === "HIRE_ASC" || state.sortMode === "HIRE_DESC") {
      const da = dateValue(ea.hireDate);
      const db = dateValue(eb.hireDate);

      if (da === null && db === null) return name(ea.name).localeCompare(name(eb.name));
      if (da === null) return 1;
      if (db === null) return -1;

      return state.sortMode === "HIRE_DESC"
        ? (db - da) || name(ea.name).localeCompare(name(eb.name))
        : (da - db) || name(ea.name).localeCompare(name(eb.name));
    }

    const oa = Number.isFinite(Number(ea.sortOrder)) ? Number(ea.sortOrder) : 999999;
    const ob = Number.isFinite(Number(eb.sortOrder)) ? Number(eb.sortOrder) : 999999;

    return (oa - ob) || name(ea.name).localeCompare(name(eb.name));
  });
}

function employeeCard(e, originalIndex) {
  const photo = safeUrl(e.photoUrl);
  const avatar = photo
    ? `<img src="${escapeAttr(photo)}" alt="" onerror="this.remove()">`
    : escapeHtml(initials(e.name));

  const directManager = e.directManager || e.manager || "";
  const chips = [
    e.team,
    directManager ? `Direct Manager: ${directManager}` : ""
  ].filter(Boolean)
   .map(value => `<span class="chip">${escapeHtml(value)}</span>`)
   .join("");

  const active = normalizeStatus(e.status) === "ACTIVE";

  return `
    <article class="employee-card">
      <div class="card-head">
        <div class="avatar">${avatar}</div>
        <span class="status ${active ? "active" : "inactive"}">${active ? "ACTIVE" : "NOT ACTIVE"}</span>
      </div>

      <h3>${escapeHtml(e.name || "Unnamed employee")}</h3>
      <div class="job-title">${escapeHtml(e.jobTitle || "Job title not assigned")}</div>

      <div class="chips">
        ${chips || '<span class="chip">No team assigned</span>'}
      </div>

      <button class="open-employee" type="button" data-employee-index="${originalIndex}">
        Open Employee
      </button>
    </article>
  `;
}

function openEmployee(e) {
  const photo = safeUrl(e.photoUrl);

  const avatar = photo
    ? `<img src="${escapeAttr(photo)}" alt="">`
    : escapeHtml(initials(e.name));

  const points = Array.isArray(e.jobDescription) ? e.jobDescription : [];
  const directManager = e.directManager || e.manager || "";
  const reportingLabel = state.data?.settings?.functionalReportingColumn || "Functional Reporting To";

  $("#employeeModalBody").innerHTML = `
    <div class="profile-head">
      <div class="profile-user">
        <div class="profile-avatar">${avatar}</div>
        <div>
          <h2>${escapeHtml(e.name || "")}</h2>
          <div class="profile-title">${escapeHtml(e.jobTitle || "")}</div>

          <div class="profile-badges">
            <span class="profile-badge">${escapeHtml(normalizeStatus(e.status))}</span>
            ${e.team ? `<span class="profile-badge">${escapeHtml(e.team)}</span>` : ""}
            ${directManager ? `<span class="profile-badge">Direct Manager: ${escapeHtml(directManager)}</span>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div class="profile-body">
      <div class="copy-row">
        <button id="copyTitleBtn" class="copy-btn title" type="button">Copy Title</button>
        <button id="copyJDBtn" class="copy-btn jd" type="button">Copy Job Description</button>
      </div>

      <div class="info-grid">
        ${infoCard("Name", e.name || "—")}
        ${infoCard("Job Title", e.jobTitle || "—")}
        ${infoCard("Hire Date", e.hireDate || "—")}
        ${infoCard("Location", e.location || "—")}
        ${infoCard(reportingLabel, e.functionalReportingTo || "—")}
        ${infoCard("Email", e.email || "—")}
      </div>

      <section class="jd-section">
        <h3>Job Description</h3>
        <div class="jd-list">
          ${renderJobDescription(points)}
        </div>
      </section>
    </div>
  `;

  $("#copyTitleBtn").addEventListener("click", () => copyText(e.jobTitle || ""));
  $("#copyJDBtn").addEventListener("click", () => {
    const text = points.map((item,index) => `${item.order || index + 1}. ${item.point}`).join("\n");
    copyText(text || "No job description available.");
  });

  openModal("#employeeModal");
}

function renderJobDescription(points) {
  if (!points.length) {
    return `<div class="no-jd">No job description has been added for this job title.</div>`;
  }

  return points.map((item,index) => `
    <div class="jd-point">
      <b>${String(item.order || index + 1).padStart(2,"0")}</b>
      ${escapeHtml(item.point || "")}
    </div>
  `).join("");
}

function infoCard(label,value) {
  return `
    <div class="info-card">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function openOrgModal() {
  openModal("#orgModal");
}

function openModal(selector) {
  const backdrop = $("#backdrop");
  const modal = $(selector);

  backdrop.classList.remove("hidden");
  modal.classList.remove("hidden");

  requestAnimationFrame(() => {
    backdrop.classList.add("show");
    modal.classList.add("show");
    modal.setAttribute("aria-hidden","false");
  });

  document.body.style.overflow = "hidden";
}

function closeModals() {
  const backdrop = $("#backdrop");

  backdrop.classList.remove("show");

  ["#employeeModal","#orgModal"].forEach(selector => {
    const modal = $(selector);
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden","true");
    setTimeout(() => modal.classList.add("hidden"),220);
  });

  setTimeout(() => backdrop.classList.add("hidden"),220);
  document.body.style.overflow = "";
}

function setHireSort(mode) {
  state.sortMode = mode;
  const button = $("#hireSortBtn");
  const label = $("#hireSortLabel");

  button.dataset.mode = mode;
  button.classList.toggle("active", mode !== "CUSTOM");

  if (mode === "HIRE_ASC") {
    label.textContent = "Hire Date ↑";
    button.title = "Oldest hire date first";
  } else if (mode === "HIRE_DESC") {
    label.textContent = "Hire Date ↓";
    button.title = "Newest hire date first";
  } else {
    label.textContent = "Hire Date";
    button.title = "Sort by hire date";
  }
}

function normalizeStatus(value) {
  const text = String(value || "ACTIVE").trim().toUpperCase().replaceAll("_"," ");
  return ["NOT ACTIVE","INACTIVE","LEFT","RESIGNED"].includes(text) ? "NOT ACTIVE" : "ACTIVE";
}

function setLoading(show) {
  $("#refreshBtn").classList.toggle("is-loading",show);
  $("#loader").classList.toggle("is-hidden",!show);
}

function showLoadError(error) {
  toast("Could not load employee data");
  console.error(error);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    toast("Copied");
  }
}

let toastTimer;
function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"),1700);
}

function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0,2)
    .map(part => part[0] || "")
    .join("")
    .toUpperCase();
}

function unique(values) {
  return [...new Set(values)];
}

function safeUrl(value) {
  const text = String(value || "").trim();
  return /^https?:\/\//i.test(text) ? text : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
