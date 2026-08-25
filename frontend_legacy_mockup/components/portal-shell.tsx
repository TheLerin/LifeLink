"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Ambulance,
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  DatabaseZap,
  Droplets,
  FlaskConical,
  HandHeart,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  UserCog,
  UsersRound,
  X,
} from "lucide-react";
import {
  clearSession,
  demoAccounts,
  makePreviewSession,
  readSession,
  roleLabels,
  saveSession,
  type Role,
  type Session,
} from "@/lib/lifelink";

type NavItem = {
  id: string;
  label: string;
  group: "Overview" | "Operations" | "Administration";
  icon: LucideIcon;
  roles: Role[];
  badge?: string;
};

const allRoles: Role[] = [
  "ADMIN",
  "DOCTOR",
  "BLOOD_BANK_STAFF",
  "ORGAN_BANK_STAFF",
  "DONOR",
  "RECIPIENT",
];

const navItems: NavItem[] = [
  { id: "dashboard", label: "Command centre", group: "Overview", icon: LayoutDashboard, roles: allRoles },
  { id: "donors", label: "Donors", group: "Operations", icon: HandHeart, roles: ["ADMIN", "BLOOD_BANK_STAFF", "ORGAN_BANK_STAFF", "DONOR"] },
  { id: "recipients", label: "Recipients", group: "Operations", icon: UsersRound, roles: ["ADMIN", "DOCTOR", "ORGAN_BANK_STAFF", "RECIPIENT"] },
  { id: "donations", label: "Donations", group: "Operations", icon: FlaskConical, roles: ["ADMIN", "BLOOD_BANK_STAFF", "ORGAN_BANK_STAFF", "DONOR"] },
  { id: "blood-units", label: "Blood inventory", group: "Operations", icon: Droplets, roles: ["ADMIN", "BLOOD_BANK_STAFF"], badge: "18" },
  { id: "emergency-requests", label: "Emergency requests", group: "Operations", icon: Ambulance, roles: ["ADMIN", "DOCTOR", "BLOOD_BANK_STAFF", "RECIPIENT"], badge: "6" },
  { id: "reservations", label: "Reservations", group: "Operations", icon: Clock3, roles: ["ADMIN", "DOCTOR", "BLOOD_BANK_STAFF", "RECIPIENT"] },
  { id: "organs", label: "Organ matching", group: "Operations", icon: HeartPulse, roles: ["ADMIN", "ORGAN_BANK_STAFF"] },
  { id: "centres", label: "Care centres", group: "Operations", icon: Building2, roles: allRoles },
  { id: "camps", label: "Donation camps", group: "Operations", icon: CalendarDays, roles: allRoles },
  { id: "reports", label: "Reports", group: "Administration", icon: BarChart3, roles: ["ADMIN", "BLOOD_BANK_STAFF", "ORGAN_BANK_STAFF"] },
  { id: "audit", label: "Audit trail", group: "Administration", icon: ShieldCheck, roles: ["ADMIN"] },
  { id: "users", label: "Users & access", group: "Administration", icon: UserCog, roles: ["ADMIN"] },
];

type ModuleData = {
  kicker: string;
  title: string;
  description: string;
  action: string;
  metric: string;
  metricLabel: string;
  columns: string[];
  rows: Array<Array<{ text: string; status?: string }>>;
};

const moduleData: Record<string, ModuleData> = {
  donors: {
    kicker: "PEOPLE & ELIGIBILITY",
    title: "Donor registry",
    description: "Search normalized donor profiles, eligibility and donation history.",
    action: "Add donor",
    metric: "1,842",
    metricLabel: "registered donors",
    columns: ["Donor", "Blood group", "Last donation", "Eligibility", "Contact"],
    rows: [
      [text("Ananya Shah"), status("O+", "blood"), text("04 Aug 2026"), status("ELIGIBLE", "available"), text("ananya@example.test")],
      [text("Rohan Iyer"), status("A−", "blood"), text("19 Jul 2026"), status("ELIGIBLE", "available"), text("rohan@example.test")],
      [text("Meera Das"), status("B+", "blood"), text("11 Aug 2026"), status("DEFERRED", "reserved"), text("meera@example.test")],
      [text("Kabir Singh"), status("AB+", "blood"), text("27 Jun 2026"), status("ELIGIBLE", "available"), text("kabir@example.test")],
    ],
  },
  recipients: {
    kicker: "CARE COORDINATION",
    title: "Recipient registry",
    description: "Role-scoped recipient records and request timelines.",
    action: "Add recipient",
    metric: "286",
    metricLabel: "active recipients",
    columns: ["Recipient", "Blood group", "Hospital", "Open request", "Priority"],
    rows: [
      [text("Isha Nair"), status("A+", "blood"), text("City General"), text("REQ-2084"), status("CRITICAL", "rejected")],
      [text("Dev Malhotra"), status("O−", "blood"), text("Starlight Hospital"), text("REQ-2079"), status("URGENT", "reserved")],
      [text("Nila Roy"), status("B+", "blood"), text("Mercy Medical"), text("—"), status("ROUTINE", "testing")],
    ],
  },
  donations: {
    kicker: "COLLECTION WORKFLOW",
    title: "Donation intake",
    description: "Track blood and organ donations from registration through screening.",
    action: "Register donation",
    metric: "42",
    metricLabel: "donations this week",
    columns: ["Donation", "Donor", "Type", "Centre", "Status"],
    rows: [
      [text("DON-3821"), text("Ananya Shah"), text("Whole blood"), text("Central Blood Bank"), status("TESTING", "testing")],
      [text("DON-3818"), text("Rohan Iyer"), text("Whole blood"), text("Central Blood Bank"), status("AVAILABLE", "available")],
      [text("DON-3811"), text("Fictional donor 14"), text("Kidney"), text("HopeBridge"), status("MATCHING", "reserved")],
    ],
  },
  "blood-units": {
    kicker: "UNIT-LEVEL INVENTORY",
    title: "Blood inventory",
    description: "FEFO-ready unit tracking with screening and lifecycle history.",
    action: "Scan unit",
    metric: "748",
    metricLabel: "units available",
    columns: ["Unit", "Group", "Component", "Collected", "Expires", "Status"],
    rows: [
      [text("BU-80421"), status("O+", "blood"), text("Packed RBC"), text("10 Aug"), text("21 Sep"), status("AVAILABLE", "available")],
      [text("BU-80418"), status("A−", "blood"), text("Whole blood"), text("09 Aug"), text("13 Sep"), status("RESERVED", "reserved")],
      [text("BU-80415"), status("B+", "blood"), text("Platelets"), text("11 Aug"), text("16 Aug"), status("TESTING", "testing")],
      [text("BU-80388"), status("AB+", "blood"), text("Plasma"), text("02 Aug"), text("01 Aug 2027"), status("AVAILABLE", "available")],
    ],
  },
  "emergency-requests": {
    kicker: "TIME-CRITICAL CARE",
    title: "Emergency requests",
    description: "Coordinate hospital demand and database-authoritative FEFO allocation.",
    action: "New request",
    metric: "6",
    metricLabel: "open critical requests",
    columns: ["Request", "Hospital", "Group", "Units", "Needed by", "Status"],
    rows: [
      [text("REQ-2084"), text("City General"), status("A+", "blood"), text("2"), text("14:30 today"), status("PENDING", "rejected")],
      [text("REQ-2081"), text("Starlight Hospital"), status("O−", "blood"), text("1"), text("15:15 today"), status("PARTIAL", "reserved")],
      [text("REQ-2079"), text("Mercy Medical"), status("B+", "blood"), text("3"), text("17:00 today"), status("FULFILLED", "available")],
    ],
  },
  reservations: {
    kicker: "CONTROLLED ALLOCATION",
    title: "Reservations",
    description: "Review atomic reservations, cancellations and issue completion.",
    action: "Open requests",
    metric: "18",
    metricLabel: "active reservations",
    columns: ["Reservation", "Request", "Unit", "Hospital", "Created", "Status"],
    rows: [
      [text("RES-9824"), text("REQ-2081"), text("BU-80418"), text("Starlight Hospital"), text("12 min ago"), status("ACTIVE", "reserved")],
      [text("RES-9819"), text("REQ-2079"), text("BU-80374"), text("Mercy Medical"), text("48 min ago"), status("ISSUED", "issued")],
      [text("RES-9816"), text("REQ-2076"), text("BU-80361"), text("City General"), text("1 hr ago"), status("CANCELLED", "issued")],
    ],
  },
  organs: {
    kicker: "TRANSPARENT MATCHING",
    title: "Organ matching",
    description: "Rank compatible candidates with a clearly labelled academic priority score.",
    action: "Register organ",
    metric: "12",
    metricLabel: "organs in matching",
    columns: ["Organ", "Type", "Bank", "Top candidate", "Academic score", "Status"],
    rows: [
      [text("ORG-0068"), text("Kidney"), text("HopeBridge"), text("Isha Nair"), text("86.40"), status("MATCHING", "reserved")],
      [text("ORG-0065"), text("Liver"), text("HopeBridge"), text("Dev Malhotra"), text("81.75"), status("SELECTED", "testing")],
      [text("ORG-0061"), text("Cornea"), text("North Organ Bank"), text("Nila Roy"), text("78.10"), status("COMPLETED", "available")],
    ],
  },
  centres: {
    kicker: "CARE NETWORK",
    title: "Care centres",
    description: "Hospitals, blood banks and organ banks in the LifeLink network.",
    action: "Add centre",
    metric: "28",
    metricLabel: "participating centres",
    columns: ["Centre", "Type", "City", "Contact", "Status"],
    rows: [
      [text("Central Blood Bank"), text("Blood bank"), text("Pune"), text("020 5550 1188"), status("ACTIVE", "available")],
      [text("HopeBridge Organ Bank"), text("Organ bank"), text("Mumbai"), text("022 5550 1402"), status("ACTIVE", "available")],
      [text("City General Hospital"), text("Hospital"), text("Pune"), text("020 5550 2200"), status("ACTIVE", "available")],
    ],
  },
  camps: {
    kicker: "COMMUNITY OUTREACH",
    title: "Donation camps",
    description: "Publish upcoming camps and manage fictional donor registration.",
    action: "Create camp",
    metric: "7",
    metricLabel: "upcoming camps",
    columns: ["Camp", "Date", "Venue", "Host bank", "Registrations", "Status"],
    rows: [
      [text("Monsoon Lifesavers"), text("18 Aug 2026"), text("Civic Hall, Pune"), text("Central Blood Bank"), text("68 / 100"), status("OPEN", "available")],
      [text("Campus Donation Day"), text("23 Aug 2026"), text("Aster College"), text("Northside Blood Bank"), text("41 / 80"), status("OPEN", "available")],
      [text("Hope Weekend"), text("02 Sep 2026"), text("Riverfront Centre"), text("Central Blood Bank"), text("18 / 120"), status("PLANNED", "testing")],
    ],
  },
  reports: {
    kicker: "DATABASE REPORTING",
    title: "Operational reports",
    description: "Views, joins and aggregates across the complete DBMS workflow.",
    action: "Export report",
    metric: "7",
    metricLabel: "live report views",
    columns: ["Report", "Coverage", "Last refreshed", "Format", "Status"],
    rows: [
      [text("Blood inventory"), text("Units by group & component"), text("Live query"), text("Table / CSV"), status("READY", "available")],
      [text("Expiring units"), text("FEFO risk window"), text("Live query"), text("Table / CSV"), status("READY", "available")],
      [text("Emergency summary"), text("Request outcomes"), text("Live query"), text("Chart / CSV"), status("READY", "available")],
      [text("Organ match ranking"), text("Transparent academic scores"), text("Live query"), text("Table / CSV"), status("READY", "available")],
    ],
  },
  audit: {
    kicker: "ACCOUNTABILITY",
    title: "Audit trail",
    description: "Review safe, non-sensitive change metadata across critical operations.",
    action: "Export audit",
    metric: "12,508",
    metricLabel: "recorded events",
    columns: ["Event", "Actor", "Entity", "Action", "Time", "Outcome"],
    rows: [
      [text("AUD-12508"), text("blood.central"), text("reservation:9824"), text("CREATE"), text("12 min ago"), status("SUCCESS", "available")],
      [text("AUD-12507"), text("doctor.maya"), text("emergency_request:2084"), text("CREATE"), text("18 min ago"), status("SUCCESS", "available")],
      [text("AUD-12506"), text("organ.hopebridge"), text("organ_match:411"), text("STATUS"), text("31 min ago"), status("SUCCESS", "available")],
    ],
  },
  users: {
    kicker: "ADMINISTRATION",
    title: "Users & access",
    description: "ADMIN-only account lifecycle, roles and institutional affiliation.",
    action: "Create user",
    metric: "64",
    metricLabel: "active accounts",
    columns: ["User", "Role", "Affiliation", "Last login", "Status"],
    rows: [
      [text("admin.demo"), text("Administrator"), text("LifeLink"), text("Just now"), status("ACTIVE", "available")],
      [text("doctor.maya"), text("Doctor"), text("City General"), text("24 min ago"), status("ACTIVE", "available")],
      [text("blood.central"), text("Blood bank staff"), text("Central Blood Bank"), text("41 min ago"), status("ACTIVE", "available")],
      [text("organ.hopebridge"), text("Organ bank staff"), text("HopeBridge"), text("2 hr ago"), status("ACTIVE", "available")],
    ],
  },
};

function text(value: string) {
  return { text: value };
}

function status(value: string, tone: string) {
  return { text: value, status: tone };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function PortalShell({ initialSection }: { initialSection: string }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readSession();
      if (!stored) {
        window.location.replace("/login");
        return;
      }
      setSession(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const availableNav = useMemo(
    () => (session ? navItems.filter((item) => item.roles.includes(session.user.role)) : []),
    [session],
  );

  if (!session) {
    return (
      <main className="shell-loader">
        <div className="brand-mark"><HeartPulse /></div>
        <span>Opening secure workspace…</span>
      </main>
    );
  }

  const current = navItems.find((item) => item.id === initialSection);
  const permitted = current ? current.roles.includes(session.user.role) : false;

  function signOut() {
    clearSession();
    window.location.assign("/login");
  }

  function switchPreviewRole(role: Role) {
    const account = demoAccounts.find((item) => item.role === role)!;
    const next = makePreviewSession(account.username);
    saveSession(next);
    setSession(next);
    window.location.assign("/dashboard");
  }

  return (
    <div className="portal-frame">
      {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><HeartPulse /></div>
          <div><strong>LifeLink</strong><span>OPERATIONS PORTAL</span></div>
          <button className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button>
        </div>

        <div className="workspace-pill">
          <div className="workspace-icon"><DatabaseZap /></div>
          <div><strong>LifeLink network</strong><span>Coursework environment</span></div>
          <ChevronDown />
        </div>

        <nav aria-label="Primary navigation">
          {(["Overview", "Operations", "Administration"] as const).map((group) => {
            const items = availableNav.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group}>
                <p>{group}</p>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <a key={item.id} href={`/${item.id}`} className={initialSection === item.id ? "nav-active" : ""}>
                      <Icon /><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-support">
          <a href="#support"><CircleHelp />Help & documentation</a>
          <a href="#settings"><Settings />Workspace settings</a>
        </div>
        <div className="sidebar-user">
          <div className="avatar">{initials(session.user.full_name)}</div>
          <div><strong>{session.user.full_name}</strong><span>{roleLabels[session.user.role]}</span></div>
          <button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut /></button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></button>
            <div className="crumbs"><span>LifeLink</span><b>/</b><strong>{current?.label ?? "Workspace"}</strong></div>
          </div>
          <div className="topbar-actions">
            <button className="search-button" onClick={() => setSearchOpen((value) => !value)}><Search /><span>Search records</span><kbd>⌘ K</kbd></button>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell /><span /></button>
            <div className="topbar-profile">
              <div className="avatar avatar-small">{initials(session.user.full_name)}</div>
              <div><strong>{session.user.full_name}</strong><span>{session.user.username}</span></div>
              <ChevronDown />
            </div>
          </div>
        </header>

        {searchOpen && (
          <div className="search-panel">
            <Search />
            <input autoFocus placeholder="Search donors, units, requests or centres…" aria-label="Global search" />
            <button className="icon-button" onClick={() => setSearchOpen(false)}><X /></button>
          </div>
        )}

        <div className="context-bar">
          <div className={`environment-badge ${session.mode}`}><span />{session.mode === "preview" ? "Seed data preview" : "Live API session"}</div>
          {session.mode === "preview" && (
            <label className="role-preview-select">
              <span>View role</span>
              <select value={session.user.role} onChange={(event) => switchPreviewRole(event.target.value as Role)}>
                {allRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
              </select>
            </label>
          )}
          <div className="api-indicator"><CheckCircle2 /> API contract ready</div>
        </div>

        <main className="main-content">
          {!current ? (
            <NotFound />
          ) : !permitted ? (
            <AccessDenied role={session.user.role} />
          ) : initialSection === "dashboard" ? (
            <Dashboard session={session} />
          ) : (
            <ModulePage module={moduleData[initialSection]} session={session} />
          )}
        </main>
      </div>
    </div>
  );
}

function Dashboard({ session }: { session: Session }) {
  const nameParts = session.user.full_name.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0]?.replace(/\.$/, "").toLowerCase() === "dr"
    ? (nameParts[1] ?? "there")
    : (nameParts[0] ?? "there");
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const stats = [
    { label: "Available blood units", value: "748", change: "+6.2%", note: "vs last month", icon: Droplets, tone: "red" },
    { label: "Open requests", value: "24", change: "6 critical", note: "needs attention", icon: Ambulance, tone: "orange" },
    { label: "Donations this week", value: "42", change: "+8", note: "from last week", icon: HandHeart, tone: "green" },
    { label: "Active organ matches", value: "12", change: "3 selected", note: "academic workflow", icon: HeartPulse, tone: "blue" },
  ];

  return (
    <>
      <section className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">OPERATIONS OVERVIEW</p>
          <h1>Good morning, {firstName}.</h1>
          <p>Here is the LifeLink network status for {today}.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button"><ArrowDownToLine /> Export snapshot</button>
          <button className="primary-button"><Plus /> New operation</button>
        </div>
      </section>

      <section className="stat-grid" aria-label="Key metrics">
        {stats.map((item) => {
          const Icon = item.icon;
          return (
            <article className="stat-card" key={item.label}>
              <div className={`stat-icon ${item.tone}`}><Icon /></div>
              <div className="stat-meta"><span>{item.label}</span><button className="icon-button"><MoreHorizontal /></button></div>
              <strong className="stat-value">{item.value}</strong>
              <p><b>{item.change}</b> {item.note}</p>
            </article>
          );
        })}
      </section>

      <section className="dashboard-grid">
        <article className="panel inventory-panel">
          <div className="panel-heading">
            <div><h2>Blood inventory by group</h2><p>Available units across all network blood banks</p></div>
            <button className="text-button">View inventory <ArrowUpRight /></button>
          </div>
          <div className="inventory-chart">
            {[
              ["O+", 156, 92], ["A+", 138, 81], ["B+", 116, 68], ["AB+", 74, 44],
              ["O−", 96, 57], ["A−", 72, 43], ["B−", 61, 36], ["AB−", 35, 21],
            ].map(([group, units, height]) => (
              <div className="blood-bar" key={group}>
                <span className="bar-value">{units}</span>
                <div className="bar-track"><span style={{ height: `${height}%` }} /></div>
                <b>{group}</b>
              </div>
            ))}
          </div>
          <div className="chart-legend"><span><i /> Available</span><span>748 units total</span><span>Updated moments ago</span></div>
        </article>

        <article className="panel attention-panel">
          <div className="panel-heading">
            <div><h2>Needs attention</h2><p>Time-sensitive operational items</p></div>
            <span className="count-pill">6</span>
          </div>
          <div className="attention-list">
            <Attention icon={Ambulance} tone="red" title="Critical A+ request" detail="City General · 2 units" time="46 min left" />
            <Attention icon={Clock3} tone="orange" title="12 units expire soon" detail="Within the next 72 hours" time="Review" />
            <Attention icon={FlaskConical} tone="blue" title="8 tests awaiting result" detail="Central Blood Bank" time="Open" />
            <Attention icon={AlertTriangle} tone="orange" title="Low O− inventory" detail="Below network threshold" time="9 units" />
          </div>
        </article>
      </section>

      <section className="dashboard-grid lower-grid">
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div><h2>Recent operations</h2><p>Latest traceable workflow events</p></div>
            <button className="text-button">Full audit trail <ArrowUpRight /></button>
          </div>
          <div className="activity-table table-scroll">
            <table>
              <thead><tr><th>Operation</th><th>Reference</th><th>Owner</th><th>Time</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td><span className="operation-icon green"><CheckCircle2 /></span>Blood unit cleared</td><td>BU-80418</td><td>Central Blood Bank</td><td>8 min ago</td><td><StatusBadge text="AVAILABLE" tone="available" /></td></tr>
                <tr><td><span className="operation-icon orange"><Ambulance /></span>Unit reserved</td><td>RES-9824</td><td>City General</td><td>12 min ago</td><td><StatusBadge text="RESERVED" tone="reserved" /></td></tr>
                <tr><td><span className="operation-icon blue"><HeartPulse /></span>Match calculated</td><td>ORG-0068</td><td>HopeBridge</td><td>31 min ago</td><td><StatusBadge text="MATCHING" tone="testing" /></td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel system-panel">
          <div className="panel-heading"><div><h2>System readiness</h2><p>Coursework implementation</p></div><Activity /></div>
          <div className="readiness-score"><strong>100%</strong><span>API contract mapped</span></div>
          <div className="readiness-list">
            <div><span><DatabaseZap />PostgreSQL workflows</span><StatusBadge text="READY" tone="available" /></div>
            <div><span><ShieldCheck />JWT & role guards</span><StatusBadge text="READY" tone="available" /></div>
            <div><span><Activity />70 API operations</span><StatusBadge text="MAPPED" tone="testing" /></div>
          </div>
        </article>
      </section>
    </>
  );
}

function Attention({ icon: Icon, tone, title, detail, time }: { icon: LucideIcon; tone: string; title: string; detail: string; time: string }) {
  return (
    <div className="attention-row">
      <div className={`attention-icon ${tone}`}><Icon /></div>
      <div><strong>{title}</strong><span>{detail}</span></div>
      <button>{time}</button>
    </div>
  );
}

function ModulePage({ module, session }: { module?: ModuleData; session: Session }) {
  if (!module) return <NotFound />;
  return (
    <>
      <section className="page-heading module-heading">
        <div>
          <p className="eyebrow">{module.kicker}</p>
          <h1>{module.title}</h1>
          <p>{module.description}</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button"><ArrowDownToLine /> Export</button>
          <button className="primary-button"><Plus /> {module.action}</button>
        </div>
      </section>

      <section className="module-overview">
        <div className="module-metric"><strong>{module.metric}</strong><span>{module.metricLabel}</span></div>
        <div className="module-flow"><CheckCircle2 /><div><strong>Backend contract mapped</strong><span>JWT scope: {roleLabels[session.user.role]}</span></div></div>
        <div className="module-flow"><DatabaseZap /><div><strong>PostgreSQL authoritative</strong><span>Preview rows are fictional seed data</span></div></div>
      </section>

      {module.title === "Organ matching" && (
        <div className="academic-notice"><ShieldCheck /><div><strong>Academic Priority Score</strong><span>Transparent coursework ranking only — not clinical transplant guidance.</span></div></div>
      )}

      <section className="panel data-panel">
        <div className="table-toolbar">
          <div className="inline-search"><Search /><input placeholder={`Search ${module.title.toLowerCase()}…`} /></div>
          <button className="secondary-button compact-button"><SlidersHorizontal /> Filters</button>
          <span className="table-count">Showing {module.rows.length} preview records</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>{module.columns.map((column) => <th key={column}>{column}</th>)}<th aria-label="Actions" /></tr></thead>
            <tbody>
              {module.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => <td key={cellIndex}>{cell.status ? <StatusBadge text={cell.text} tone={cell.status} /> : cell.text}</td>)}
                  <td><button className="icon-button"><MoreHorizontal /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>Seed preview only</span><div><button disabled>Previous</button><b>1</b><button disabled>Next</button></div></div>
      </section>
    </>
  );
}

function StatusBadge({ text: label, tone }: { text: string; tone: string }) {
  return <span className={`status-badge status-${tone}`}><i />{label}</span>;
}

function AccessDenied({ role }: { role: Role }) {
  return (
    <section className="empty-state">
      <div className="empty-icon"><ShieldCheck /></div>
      <p className="eyebrow">ROLE PROTECTED</p>
      <h1>This module is outside your scope.</h1>
      <p>{roleLabels[role]} accounts cannot access this route. LifeLink hides restricted navigation and guards the API independently.</p>
      <Link className="primary-button" href="/dashboard">Return to command centre</Link>
    </section>
  );
}

function NotFound() {
  return (
    <section className="empty-state">
      <div className="empty-icon"><Stethoscope /></div>
      <p className="eyebrow">NOT FOUND</p>
      <h1>That workspace module does not exist.</h1>
      <p>Return to the command centre to continue with LifeLink operations.</p>
      <Link className="primary-button" href="/dashboard">Return to command centre</Link>
    </section>
  );
}
