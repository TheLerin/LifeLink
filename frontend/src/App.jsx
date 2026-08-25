/**
 * App - the route table.
 *
 * Public:      /login
 * Everything else is wrapped in <ProtectedRoute> (needs a session) and rendered
 * inside <AppShell>. Role-restricted branches are additionally wrapped in
 * <RoleRoute allow={...}>, whose allow-lists mirror the backend guards exactly
 * (see constants/navigation.js ROUTE_ROLES).
 */

import { Navigate, Route, Routes } from "react-router-dom";

import AppShell from "./components/AppShell.jsx";
import { ProtectedRoute, RoleRoute } from "./components/RouteGuards.jsx";
import { ROLES } from "./constants/lifelink.js";

import LoginPage from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import AccountPage from "./pages/AccountPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

import DonorsPage from "./pages/DonorsPage.jsx";
import DonorDetailPage from "./pages/DonorDetailPage.jsx";
import RecipientsPage from "./pages/RecipientsPage.jsx";
import RecipientDetailPage from "./pages/RecipientDetailPage.jsx";
import DoctorsPage from "./pages/DoctorsPage.jsx";
import HospitalsPage from "./pages/HospitalsPage.jsx";
import BloodBanksPage from "./pages/BloodBanksPage.jsx";
import OrganBanksPage from "./pages/OrganBanksPage.jsx";
import DonationsPage from "./pages/DonationsPage.jsx";
import CampsPage from "./pages/CampsPage.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import AuditPage from "./pages/AuditPage.jsx";

import BloodUnitsPage from "./pages/BloodUnitsPage.jsx";
import BloodUnitDetailPage from "./pages/BloodUnitDetailPage.jsx";
import EmergencyRequestsPage from "./pages/EmergencyRequestsPage.jsx";
import EmergencyRequestDetailPage from "./pages/EmergencyRequestDetailPage.jsx";
import ReservationsPage from "./pages/ReservationsPage.jsx";
import OrgansPage from "./pages/OrgansPage.jsx";
import OrganDetailPage from "./pages/OrganDetailPage.jsx";

import ReportsPage from "./pages/ReportsPage.jsx";
import ReportDetailPage from "./pages/ReportDetailPage.jsx";

const { ADMIN, DOCTOR, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF, DONOR, RECIPIENT } =
  ROLES;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="account" element={<AccountPage />} />

          {/* People */}
          <Route
            element={
              <RoleRoute allow={[ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF]} />
            }
          >
            <Route path="donors" element={<DonorsPage />} />
          </Route>
          <Route
            element={
              <RoleRoute
                allow={[ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF, DONOR]}
              />
            }
          >
            <Route path="donors/:donorId" element={<DonorDetailPage />} />
          </Route>

          <Route
            element={
              <RoleRoute allow={[ADMIN, DOCTOR, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF]} />
            }
          >
            <Route path="recipients" element={<RecipientsPage />} />
          </Route>
          <Route
            element={
              <RoleRoute
                allow={[
                  ADMIN,
                  DOCTOR,
                  BLOOD_BANK_STAFF,
                  ORGAN_BANK_STAFF,
                  RECIPIENT,
                ]}
              />
            }
          >
            <Route
              path="recipients/:recipientId"
              element={<RecipientDetailPage />}
            />
          </Route>

          <Route element={<RoleRoute allow={[ADMIN, DOCTOR]} />}>
            <Route path="doctors" element={<DoctorsPage />} />
          </Route>

          {/* Blood operations */}
          <Route
            element={
              <RoleRoute allow={[ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF, DONOR]} />
            }
          >
            <Route path="donations" element={<DonationsPage />} />
          </Route>

          <Route element={<RoleRoute allow={[ADMIN, BLOOD_BANK_STAFF]} />}>
            <Route path="blood-units" element={<BloodUnitsPage />} />
            <Route path="blood-units/:unitId" element={<BloodUnitDetailPage />} />
          </Route>

          <Route
            element={
              <RoleRoute
                allow={[ADMIN, DOCTOR, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF, RECIPIENT]}
              />
            }
          >
            <Route path="emergency-requests" element={<EmergencyRequestsPage />} />
            <Route
              path="emergency-requests/:requestId"
              element={<EmergencyRequestDetailPage />}
            />
          </Route>

          <Route
            element={
              <RoleRoute allow={[ADMIN, DOCTOR, BLOOD_BANK_STAFF, RECIPIENT]} />
            }
          >
            <Route path="reservations" element={<ReservationsPage />} />
          </Route>

          {/* Organ operations */}
          <Route element={<RoleRoute allow={[ADMIN, ORGAN_BANK_STAFF]} />}>
            <Route path="organs" element={<OrgansPage />} />
            <Route path="organs/:organId" element={<OrganDetailPage />} />
          </Route>

          {/* Network - readable by everyone */}
          <Route path="hospitals" element={<HospitalsPage />} />
          <Route path="blood-banks" element={<BloodBanksPage />} />
          <Route path="organ-banks" element={<OrganBanksPage />} />
          <Route path="camps" element={<CampsPage />} />

          {/* Administration */}
          <Route
            element={
              <RoleRoute allow={[ADMIN, BLOOD_BANK_STAFF, ORGAN_BANK_STAFF]} />
            }
          >
            <Route path="reports" element={<ReportsPage />} />
            <Route path="reports/:slug" element={<ReportDetailPage />} />
          </Route>

          <Route element={<RoleRoute allow={[ADMIN]} />}>
            <Route path="audit" element={<AuditPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
