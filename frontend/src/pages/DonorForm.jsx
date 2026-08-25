/**
 * DonorForm - create a donor (ADMIN only).
 *
 * Mirrors DonorCreateRequest exactly: full_name, date_of_birth, gender,
 * address, weight_kg, blood_group, is_active, and 1-5 phones with exactly one
 * primary. The backend and the CHECK constraints validate all of this again;
 * the client-side rules just spare a round-trip for obvious mistakes.
 */

import { useState } from "react";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import { Callout } from "../components/States.jsx";
import {
  FormGrid,
  SelectField,
  TextField,
  CheckboxField,
} from "../components/FormFields.jsx";
import AddressFields, {
  EMPTY_ADDRESS,
  addressPayload,
} from "../components/AddressFields.jsx";
import { Plus, X } from "../components/icons.js";
import { GENDERS, BLOOD_GROUPS } from "../constants/lifelink.js";
import { endpoints } from "../api/endpoints.js";
import { useMutation } from "../hooks/useApi.js";
import { useToast } from "../context/ToastContext.jsx";
import { todayIso } from "../utils/format.js";

export default function DonorForm({ onClose, onCreated }) {
  const toast = useToast();
  const { run, pending, error } = useMutation(endpoints.donors.create);

  const [form, setForm] = useState({
    full_name: "",
    date_of_birth: "",
    gender: "",
    weight_kg: "",
    blood_group: "",
    is_active: true,
  });
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [phones, setPhones] = useState([{ phone_number: "", is_primary: true }]);
  const [localError, setLocalError] = useState(null);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  const fieldErrors = error?.fieldErrors ? error.fieldErrors() : {};

  function updatePhone(index, patch) {
    setPhones((prev) =>
      prev.map((phone, i) => (i === index ? { ...phone, ...patch } : phone)),
    );
  }

  function setPrimary(index) {
    setPhones((prev) =>
      prev.map((phone, i) => ({ ...phone, is_primary: i === index })),
    );
  }

  function addPhone() {
    if (phones.length >= 5) return;
    setPhones((prev) => [...prev, { phone_number: "", is_primary: false }]);
  }

  function removePhone(index) {
    setPhones((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Guarantee exactly one primary remains.
      if (!next.some((phone) => phone.is_primary) && next.length > 0) {
        next[0].is_primary = true;
      }
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLocalError(null);

    const cleanedPhones = phones
      .map((phone) => ({
        phone_number: phone.phone_number.trim(),
        is_primary: phone.is_primary,
      }))
      .filter((phone) => phone.phone_number);

    if (cleanedPhones.length === 0) {
      setLocalError("Add at least one phone number.");
      return;
    }
    if (cleanedPhones.filter((phone) => phone.is_primary).length !== 1) {
      setLocalError("Mark exactly one phone number as primary.");
      return;
    }

    const payload = {
      full_name: form.full_name.trim(),
      date_of_birth: form.date_of_birth,
      gender: form.gender,
      address: addressPayload(address),
      weight_kg: Number(form.weight_kg),
      blood_group: form.blood_group,
      is_active: form.is_active,
      phones: cleanedPhones,
    };

    try {
      const created = await run(payload);
      toast.success(`Donor “${created.full_name}” created.`, "Donor added");
      onCreated();
    } catch {
      /* error surfaced below via the mutation state */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New donor"
      description="Register a donor. Fields are validated by the database on save."
      size="xl"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="donor-form" loading={pending}>
            Create donor
          </Button>
        </>
      }
    >
      <form id="donor-form" onSubmit={handleSubmit} className="space-y-5">
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
            name="blood_group"
            label="Blood group"
            value={form.blood_group}
            onChange={set("blood_group")}
            options={BLOOD_GROUPS}
            error={fieldErrors.blood_group}
            required
          />
          <TextField
            name="weight_kg"
            label="Weight (kg)"
            type="number"
            value={form.weight_kg}
            onChange={set("weight_kg")}
            error={fieldErrors.weight_kg}
            min="1"
            max="500"
            step="0.01"
            required
          />
          <div className="flex items-end pb-2">
            <CheckboxField
              name="is_active"
              label="Active donor"
              checked={form.is_active}
              onChange={set("is_active")}
              hint="Inactive donors are retained but excluded from eligibility."
            />
          </div>
        </FormGrid>

        <AddressFields value={address} onChange={setAddress} errors={fieldErrors} />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              Phone numbers
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={addPhone}
              disabled={phones.length >= 5}
            >
              Add phone
            </Button>
          </div>
          <div className="space-y-2">
            {phones.map((phone, index) => (
              <div key={index} className="flex items-center gap-3">
                <input
                  type="tel"
                  value={phone.phone_number}
                  onChange={(e) =>
                    updatePhone(index, { phone_number: e.target.value })
                  }
                  placeholder="Phone number"
                  className="ll-input flex-1"
                  maxLength={20}
                />
                <label className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input
                    type="radio"
                    name="primary-phone"
                    checked={phone.is_primary}
                    onChange={() => setPrimary(index)}
                    className="h-4 w-4 text-blood-600 focus:ring-blood-500"
                  />
                  Primary
                </label>
                {phones.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removePhone(index)}
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    aria-label="Remove phone"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            One to five numbers, with exactly one marked primary.
          </p>
        </div>

        {localError ? <Callout tone="danger">{localError}</Callout> : null}
        {error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}
