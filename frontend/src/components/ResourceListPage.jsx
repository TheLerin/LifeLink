/**
 * ResourceListPage - a whole list screen from one config object.
 *
 * Directory modules (donors, recipients, doctors, hospitals, banks, camps,
 * users, audit) differ only in their columns, filters, endpoint and create
 * form, so they share this component. Workflow-heavy screens (blood units,
 * emergency requests, reservations, organs) are hand-built instead because
 * their actions are too specific to generalise.
 *
 * Config shape:
 *   {
 *     title, description, icon,
 *     fetcher: (params) => Promise<PageResponse>,
 *     columns: [...DataTable columns],
 *     filters: [...FilterBar filters],
 *     rowLink: (row) => "/path" | null,
 *     canCreate: bool, createLabel, renderCreate: ({ onClose, onCreated }) => node,
 *     emptyTitle, emptyMessage,
 *   }
 */

import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { PageHeader } from "./Layout.jsx";
import { Section } from "./States.jsx";
import DataTable from "./DataTable.jsx";
import FilterBar from "./FilterBar.jsx";
import Pagination from "./Pagination.jsx";
import Button from "./Button.jsx";
import { Plus } from "./icons.js";
import { usePagedList } from "../hooks/useApi.js";

export default function ResourceListPage({ config }) {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const list = usePagedList(config.fetcher, {
    initialFilters: config.initialFilters || {},
    pageSize: config.pageSize || 20,
  });

  const headerActions = [];
  if (config.headerActions) headerActions.push(config.headerActions(list));
  if (config.canCreate) {
    headerActions.push(
      <Button key="create" icon={Plus} onClick={() => setCreateOpen(true)}>
        {config.createLabel || "New"}
      </Button>,
    );
  }

  return (
    <div>
      <PageHeader
        title={config.title}
        description={config.description}
        icon={config.icon}
        actions={headerActions.length ? headerActions : null}
      />

      <Section
        bodyClassName=""
        className="overflow-hidden"
      >
        {config.filters && config.filters.length ? (
          <FilterBar
            filters={config.filters}
            values={list.filters}
            onChange={list.setFilter}
            onReset={list.resetFilters}
            onRefresh={list.reload}
          />
        ) : null}

        <DataTable
          columns={config.columns}
          rows={list.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={config.rowKey}
          onRowClick={
            config.rowLink
              ? (row) => {
                  const to = config.rowLink(row);
                  if (to) navigate(to);
                }
              : undefined
          }
          emptyTitle={config.emptyTitle}
          emptyMessage={config.emptyMessage}
          emptyIcon={config.icon}
          footer={
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              totalPages={list.totalPages}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          }
        />
      </Section>

      {config.renderCreate && createOpen
        ? config.renderCreate({
            onClose: () => setCreateOpen(false),
            onCreated: () => {
              setCreateOpen(false);
              list.reload();
            },
          })
        : null}
    </div>
  );
}
