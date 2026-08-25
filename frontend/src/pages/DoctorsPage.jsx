/**
 * DoctorsPage - the doctor directory (ADMIN reads the list; ADMIN creates).
 *
 * The list endpoint is ADMIN-only, but /doctors/{id} also allows a DOCTOR to
 * read their own record. The route table therefore lets DOCTOR reach this path;
 * a doctor landing here sees the backend's 403 rendered by ErrorState, which is
 * honest about why. Server-side filters: hospital_id and search.
 */

import { useState } from "react";
import ResourceListPage from "../components/ResourceListPage.jsx";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import { Callout } from "../components/States.jsx";
import { FormGrid, SelectField, TextField } from "../components/FormFields.jsx";
import AddressFields, {
  EMPTY_ADDRESS,
  addressPayload,
} from "../components/AddressFields.jsx";
import { endpoints } from "../api/endpoints.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useMutation } from "../hooks/useApi.js";
import { useHospitalOptions } from "../hooks/useLookups.js";
import { useToast } from "../context/ToastContext.jsx";
import { GENDERS, ROLES } from "../constants/lifelink.js";
import { Stethoscope } from "../components/icons.js";
import { todayIso } from "../utils/format.js";

function DoctorForm({ onClose, onCreated }) {
  const toast = useToast();
  const { run, pending, error } = useMutation(endpoints.doctors.create);
  const hospitals = useHospitalOptions();

  const [form, setForm] = useState({
    full_name: "",
    date_of_birth: "",
    gender: "",
    hospital_id: "",
    specialization: "",
    license_no: "",
  });
  const [address, setAddress] = useState(EMPTY_ADDRESS);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));
  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      const created = await run({
        full_name: form.full_name.trim(),
        date_of_birth: form.date_of_birth,
        gender: form.gender,
        address: addressPayload(address),
        hospital_id: Number(form.hospital_id),
        specialization: form.specialization.trim(),
        license_no: form.license_no.trim(),
      });
      toast.success(`Dr ${created.full_name} added.`, "Doctor created");
      onCreated();
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New doctor"
      description="Register a doctor against a hospital in the network."
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="doctor-form" loading={pending}>
            Create doctor
          </Button>
        </>
      }
    >
      <form id="doctor-form" onSubmit={handleSubmit} className="space-y-5">
        <FormGrid columns={2}>
          <TextField
            name="full_name"
            label="Full name"
            value={form.full_name}
            onChange={set("full_name")}
            error={fieldErrors.full_name}
            maxLength={120}
            required
          />
          <TextField
            name="date_of_birth"
            label="Date of birth"
            type="date"
            value={form.date_of_birth}
            onChange={set("date_of_birth")}
            error={fieldErrors.date_of_birth}
            max={todayIso()}
            required
          />
          <SelectField
            name="gender"
            label="Gender"
            value={form.gender}
            onChange={set("gender")}
            options={GENDERS}
            error={fieldErrors.gender}
            required
          />
          <SelectField
            name="hospital_id"
            label="Hospital"
            value={form.hospital_id}
            onChange={set("hospital_id")}
            options={hospitals.options}
            placeholder={hospitals.loading ? "Loading hospitals…" : "Select hospital"}
            error={fieldErrors.hospital_id}
            disabled={hospitals.loading}
            required
          />
          <TextField
            name="specialization"
            label="Specialization"
            value={form.specialization}
            onChange={set("specialization")}
            error={fieldErrors.specialization}
            placeholder="Haematology"
            maxLength={100}
            required
          />
          <TextField
            name="license_no"
            label="Licence number"
            value={form.license_no}
            onChange={set("license_no")}
            error={fieldErrors.license_no}
            hint="Must be unique across the network."
            maxLength={60}
            required
          />
        </FormGrid>

        <AddressFields value={address} onChange={setAddress} errors={fieldErrors} />

        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}

export default function DoctorsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;
  const hospitals = useHospitalOptions({ activeOnly: false });

  const config = {
    title: "Doctors",
    description: "Clinicians who may raise emergency blood and organ requests.",
    icon: Stethoscope,
    fetcher: (params) => endpoints.doctors.list(params),
    rowKey: (row) => row.doctor_id,
    canCreate: isAdmin,
    createLabel: "New doctor",
    renderCreate: isAdmin
      ? ({ onClose, onCreated }) => (
          <DoctorForm onClose={onClose} onCreated={onCreated} />
        )
      : undefined,
    filters: [
      {
        key: "search",
        label: "Search",
        type: "search",
        placeholder: "Name or specialization…",
        width: "w-72",
      },
      {
        key: "hospital_id",
        label: "Hospital",
        type: "select",
        options: hospitals.options,
      },
    ],
    emptyTitle: "No doctors found",
    emptyMessage: "Adjust your filters, or register a doctor.",
    columns: [
      {
        key: "doctor_id",
        header: "ID",
        render: (row) => (
          <span className="font-medium text-slate-900">#{row.doctor_id}</span>
        ),
      },
      {
        key: "full_name",
        header: "Name",
        render: (row) => (
          <span className="font-medium text-slate-900">{row.full_name}</span>
        ),
      },
      { key: "specialization", header: "Specialization" },
      {
        key: "license_no",
        header: "Licence",
        render: (row) => (
          <span className="font-mono text-xs text-slate-600">{row.license_no}</span>
        ),
      },
      { key: "hospital_name", header: "Hospital" },
    ],
  };

  return <ResourceListPage config={config} />;
}
