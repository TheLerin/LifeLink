/**
 * BloodBanksPage - blood bank directory. Readable by every signed-in role;
 * only ADMIN may add one.
 */

import FacilityDirectory from "../components/FacilityDirectory.jsx";
import { endpoints } from "../api/endpoints.js";
import { Building } from "../components/icons.js";

const descriptor = {
  title: "Blood banks",
  singular: "Blood bank",
  plural: "Blood banks",
  description:
    "Facilities that collect, screen and store blood units, and fulfil reservations.",
  createHint: "Add a facility that can collect and store blood units.",
  icon: Building,
  idKey: "blood_bank_id",
  list: (params) => endpoints.bloodBanks.list(params),
  create: (body) => endpoints.bloodBanks.create(body),
};

export default function BloodBanksPage() {
  return <FacilityDirectory descriptor={descriptor} />;
}
