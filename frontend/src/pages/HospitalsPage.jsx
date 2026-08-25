/**
 * HospitalsPage - hospital directory. Readable by every signed-in role;
 * only ADMIN may add one.
 */

import FacilityDirectory from "../components/FacilityDirectory.jsx";
import { endpoints } from "../api/endpoints.js";
import { Building2 } from "../components/icons.js";

const descriptor = {
  title: "Hospitals",
  singular: "Hospital",
  plural: "Hospitals",
  description:
    "Hospitals in the network. Emergency requests are raised against a hospital.",
  createHint: "Add a hospital that can raise emergency blood and organ requests.",
  icon: Building2,
  idKey: "hospital_id",
  list: (params) => endpoints.hospitals.list(params),
  create: (body) => endpoints.hospitals.create(body),
};

export default function HospitalsPage() {
  return <FacilityDirectory descriptor={descriptor} />;
}
