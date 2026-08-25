/**
 * DonationForm - record a blood or organ donation.
 *
 * Two shapes behind one dialog, matching the backend exactly:
 *   POST /donations/blood  (admin_blood)  -> BloodDonationCreateRequest
 *   POST /donations/organ  (admin_organ)  -> OrganDonationCreateRequest
 *
 * Which types are offered depends on the caller's role: a blood-bank user only
 * sees the blood form, an organ-bank user only the organ form, ADMIN sees both.
 * Registering a donation is what creates the underlying unit, so the success
 * toast reports the new unit id and its starting status.
 */

import { useMemo, useState } from "react";
import Modal from "../components/Modal.jsx";
import Button from "../components/Button.jsx";
import { Callout } from "../components/States.jsx";
import {
  FormGrid,
  SelectField,
  TextField,
  TextAreaField,
} from "../components/FormFields.jsx";
import { endpoints } from "../api/endpoints.js";
import { useMutation } from "../hooks/useApi.js";
import {
  useBloodBankOptions,
  useOrganBankOptions,
  useCampOptions,
  useDonorOptions,
} from "../hooks/useLookups.js";
import { useToast } from "../context/ToastContext.jsx";
import { REQUEST_TYPES } from "../constants/lifelink.js";
import { todayIso } from "../utils/format.js";

/** A sensible default expiry: 42 days after collection (blueprint academic rule). */
function defaultExpiry(dateIso) {
  if (!dateIso) return "";
  const base = new Date(dateIso);
  base.setDate(base.getDate() + 42);
  return base.toISOString().slice(0, 10);
}

export default function DonationForm({ allowedTypes, onClose, onCreated }) {
  const toast = useToast();
  const [type, setType] = useState(allowedTypes[0]);

  const donors = useDonorOptions({ enabled: true });
  const bloodBanks = useBloodBankOptions();
  const organBanks = useOrganBankOptions();
  const camps = useCampOptions();

  const bloodMutation = useMutation(endpoints.donations.createBlood);
  const organMutation = useMutation(endpoints.donations.createOrgan);
  const active = type === "BLOOD" ? bloodMutation : organMutation;

  const [donationDate, setDonationDate] = useState(todayIso());
  const [form, setForm] = useState({
    donor_id: "",
    collection_bank_id: "",
    collection_organ_bank_id: "",
    camp_id: "",
    quantity_collected_ml: "450",
    expiry_date: defaultExpiry(todayIso()),
    organ_type: "",
    notes: "",
  });

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));
  const fieldErrors = active.error?.fieldErrors ? active.error.fieldErrors() : {};

  const typeOptions = useMemo(
    () => REQUEST_TYPES.filter((t) => allowedTypes.includes(t)),
    [allowedTypes],
  );

  function onDateChange(value) {
    setDonationDate(value);
    // Keep expiry a sensible distance ahead unless the user has diverged.
    setForm((prev) => ({ ...prev, expiry_date: defaultExpiry(value) }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const common = {
      donor_id: Number(form.donor_id),
      donation_date: donationDate,
      notes: form.notes.trim() || undefined,
    };
    if (form.camp_id) common.camp_id = Number(form.camp_id);

    try {
      let created;
      if (type === "BLOOD") {
        created = await bloodMutation.run({
          ...common,
          collection_bank_id: Number(form.collection_bank_id),
          quantity_collected_ml: Number(form.quantity_collected_ml),
          expiry_date: form.expiry_date,
        });
        toast.success(
          `Blood unit #${created.blood_unit_id} recorded (${created.unit_status}).`,
          "Donation registered",
        );
      } else {
        created = await organMutation.run({
          ...common,
          collection_organ_bank_id: Number(form.collection_organ_bank_id),
          organ_type: form.organ_type.trim(),
        });
        toast.success(
          `Organ unit #${created.organ_unit_id} recorded (${created.unit_status}).`,
          "Donation registered",
        );
      }
      onCreated();
    } catch {
      /* surfaced below */
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record donation"
      description="Registering a donation creates the blood or organ unit and its audit trail."
      size="lg"
      busy={active.pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={active.pending}>
            Cancel
          </Button>
          <Button type="submit" form="donation-form" loading={active.pending}>
            Register donation
          </Button>
        </>
      }
    >
      <form id="donation-form" onSubmit={handleSubmit} className="space-y-5">
        {typeOptions.length > 1 ? (
          <SelectField
            name="donation_type"
            label="Donation type"
            value={type}
            onChange={setType}
            options={typeOptions}
            required
          />
        ) : (
          <Callout tone="neutral">
            Recording a <span className="font-semibold">{type}</span> donation.
          </Callout>
        )}

        <FormGrid columns={2}>
          <SelectField
            name="donor_id"
            label="Donor"
            value={form.donor_id}
            onChange={set("donor_id")}
            options={donors.options}
            placeholder={donors.loading ? "Loading donors…" : "Select donor"}
            error={fieldErrors.donor_id}
            disabled={donors.loading}
            required
          />
          <TextField
            name="donation_date"
            label="Donation date"
            type="date"
            value={donationDate}
            onChange={onDateChange}
            error={fieldErrors.donation_date}
            max={todayIso()}
            required
          />

          {type === "BLOOD" ? (
            <>
              <SelectField
                name="collection_bank_id"
                label="Collection blood bank"
                value={form.collection_bank_id}
                onChange={set("collection_bank_id")}
                options={bloodBanks.options}
                placeholder={
                  bloodBanks.loading ? "Loading banks…" : "Select blood bank"
                }
                error={fieldErrors.collection_bank_id}
                disabled={bloodBanks.loading}
                required
              />
              <TextField
                name="quantity_collected_ml"
                label="Volume collected (mL)"
                type="number"
                value={form.quantity_collected_ml}
                onChange={set("quantity_collected_ml")}
                error={fieldErrors.quantity_collected_ml}
                min="1"
                max="1000"
                required
              />
              <TextField
                name="expiry_date"
                label="Expiry date"
                type="date"
                value={form.expiry_date}
                onChange={set("expiry_date")}
                error={fieldErrors.expiry_date}
                hint="Must be after the donation date."
                min={donationDate}
                required
              />
            </>
          ) : (
            <>
              <SelectField
                name="collection_organ_bank_id"
                label="Collection organ bank"
                value={form.collection_organ_bank_id}
                onChange={set("collection_organ_bank_id")}
                options={organBanks.options}
                placeholder={
                  organBanks.loading ? "Loading banks…" : "Select organ bank"
                }
                error={fieldErrors.collection_organ_bank_id}
                disabled={organBanks.loading}
                required
              />
              <TextField
                name="organ_type"
                label="Organ type"
                value={form.organ_type}
                onChange={set("organ_type")}
                error={fieldErrors.organ_type}
                placeholder="KIDNEY, LIVER…"
                maxLength={50}
                required
              />
            </>
          )}

          <SelectField
            name="camp_id"
            label="Donation camp (optional)"
            value={form.camp_id}
            onChange={set("camp_id")}
            options={camps.options}
            placeholder={camps.loading ? "Loading camps…" : "No camp"}
            error={fieldErrors.camp_id}
          />
        </FormGrid>

        <TextAreaField
          name="notes"
          label="Notes (optional)"
          value={form.notes}
          onChange={set("notes")}
          error={fieldErrors.notes}
          maxLength={1000}
          rows={2}
        />

        {active.error && !Object.keys(fieldErrors).length ? (
          <Callout tone="danger">{active.error.message}</Callout>
        ) : null}
      </form>
    </Modal>
  );
}
