/**
 * OrganBanksPage - organ bank directory. Readable by every signed-in role;
 * only ADMIN may add one.
 */

import FacilityDirectory from "../components/FacilityDirectory.jsx";
import { endpoints } from "../api/endpoints.js";
import { Landmark } from "../components/icons.js";

const descriptor = {
  title: "Organ banks",
  singular: "Organ bank",
  plural: "Organ banks",
  description:
    "Facilities that register organ units and run the academic matching workflow.",
  createHint: "Add a facility that can register and hold organ units.",
  icon: Landmark,
  idKey: "organ_bank_id",
  list: (params) => endpoints.organBanks.list(params),
  create: (body) => endpoints.organBanks.create(body),
};

export default function OrganBanksPage() {
  return <FacilityDirectory descriptor={descriptor} />;
}
