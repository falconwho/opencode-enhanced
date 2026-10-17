import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import {
  closestCenter,
  createDraggable,
  createDroppable,
  createSortable,
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { createMediaQuery } from "@solid-primitives/media"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { Button } from "@opencode-ai/ui/button"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { type LocalProject } from "@/context/layout"
import { useServerSync, useQueryOptions } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { pathKey } from "@/utils/path-key"
import { decode64 } from "@/utils/base64"
import { NewSessionItem, SessionItem, SessionSkeleton } from "./sidebar-items"
import { createSessionFolders, type SessionFolder } from "./session-folders"
import { sortedRootSessions } from "./helpers"
import { useIsFetching } from "@tanstack/solid-query"

type InlineEditorComponent = (props: {
  id: string
  value: Accessor<string>
  onSave: (next: string) => void
  class?: string
  displayClass?: string
  editing?: boolean
  stopPropagation?: boolean
  openOnDblClick?: boolean
}) => JSX.Element

export type WorkspaceSidebarContext = {
  currentDir: Accessor<string>
  navList: Accessor<Session[]>
  sidebarExpanded: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  renameWorkspace: (directory: string, next: string, projectId?: string, branch?: string) => void
  editorOpen: (id: string) => boolean
  openEditor: (id: string, value: string) => void
  closeEditor: () => void
  setEditor: (key: "value", value: string) => void
  InlineEditor: InlineEditorComponent
  isBusy: (directory: string) => boolean
  workspaceExpanded: (directory: string, local: boolean) => boolean
  setWorkspaceExpanded: (directory: string, value: boolean) => void
  showResetWorkspaceDialog: (root: string, directory: string) => void
  showDeleteWorkspaceDialog: (root: string, directory: string) => void
  setScrollContainerRef: (el: HTMLDivElement | undefined, mobile?: boolean) => void
}

export const WorkspaceDragOverlay = (props: {
  sidebarProject: Accessor<LocalProject | undefined>
  activeWorkspace: Accessor<string | undefined>
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
}): JSX.Element => {
  const serverSync = useServerSync()
  const language = useLanguage()
  const label = createMemo(() => {
    const project = props.sidebarProject()
    if (!project) return
    const directory = props.activeWorkspace()
    if (!directory) return

    const [workspaceStore] = serverSync().child(directory, { bootstrap: false })
    const kind =
      directory === project.worktree ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")
    const name = props.workspaceLabel(directory, workspaceStore.vcs?.branch, project.id)
    return `${kind} : ${name}`
  })

  return (
    <Show when={label()}>
      {(value) => <div class="bg-background-base rounded-md px-2 py-1 text-14-medium text-text-strong">{value()}</div>}
    </Show>
  )
}

const WorkspaceHeader = (props: {
  local: Accessor<boolean>
  busy: Accessor<boolean>
  open: Accessor<boolean>
  directory: string
  language: ReturnType<typeof useLanguage>
  branch: Accessor<string | undefined>
  workspaceValue: Accessor<string>
  workspaceEditActive: Accessor<boolean>
  InlineEditor: WorkspaceSidebarContext["InlineEditor"]
  renameWorkspace: WorkspaceSidebarContext["renameWorkspace"]
  setEditor: WorkspaceSidebarContext["setEditor"]
  projectId?: string
}): JSX.Element => (
  <div class="flex items-center gap-1 min-w-0 flex-1">
    <div class="flex items-center justify-center shrink-0 size-6">
      <Show when={props.busy()} fallback={<Icon name="branch" size="small" />}>
        <Spinner class="size-[15px]" />
      </Show>
    </div>
    <span class="text-14-medium text-text-base shrink-0">
      {props.local() ? props.language.t("workspace.type.local") : props.language.t("workspace.type.sandbox")} :
    </span>
    <Show
      when={!props.local()}
      fallback={
        <span class="text-14-medium text-text-base min-w-0 truncate">
          {props.branch() ?? getFilename(props.directory)}
        </span>
      }
    >
      <props.InlineEditor
        id={`workspace:${props.directory}`}
        value={props.workspaceValue}
        onSave={(next) => {
          const trimmed = next.trim()
          if (!trimmed) return
          props.renameWorkspace(props.directory, trimmed, props.projectId, props.branch())
          props.setEditor("value", props.workspaceValue())
        }}
        class="text-14-medium text-text-base min-w-0 truncate"
        displayClass="text-14-medium text-text-base min-w-0 truncate"
        editing={props.workspaceEditActive()}
        stopPropagation={false}
        openOnDblClick={false}
      />
    </Show>
    <div class="flex items-center justify-center shrink-0 overflow-hidden w-0 opacity-0 transition-all duration-200 group-hover/workspace:w-3.5 group-hover/workspace:opacity-100 group-focus-within/workspace:w-3.5 group-focus-within/workspace:opacity-100">
      <Icon name={props.open() ? "chevron-down" : "chevron-right"} size="small" class="text-icon-base" />
    </div>
  </div>
)

const WorkspaceActions = (props: {
  directory: string
  local: Accessor<boolean>
  busy: Accessor<boolean>
  menuOpen: Accessor<boolean>
  pendingRename: Accessor<boolean>
  setMenuOpen: (open: boolean) => void
  setPendingRename: (value: boolean) => void
  sidebarHovering: Accessor<boolean>
  touch: Accessor<boolean>
  language: ReturnType<typeof useLanguage>
  workspaceValue: Accessor<string>
  openEditor: WorkspaceSidebarContext["openEditor"]
  showResetWorkspaceDialog: WorkspaceSidebarContext["showResetWorkspaceDialog"]
  showDeleteWorkspaceDialog: WorkspaceSidebarContext["showDeleteWorkspaceDialog"]
  root: string
  clearHoverProjectSoon: WorkspaceSidebarContext["clearHoverProjectSoon"]
  navigateToNewSession: () => void
}): JSX.Element => (
  <div
    class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity"
    classList={{
      "opacity-100 pointer-events-auto": props.menuOpen(),
      "opacity-0 pointer-events-none": !props.menuOpen(),
      "group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto": true,
      "group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto": true,
    }}
  >
    <DropdownMenu
      modal={!props.sidebarHovering()}
      open={props.menuOpen()}
      onOpenChange={(open) => props.setMenuOpen(open)}
    >
      <Tooltip value={props.language.t("common.moreOptions")} placement="top">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          class="size-6 rounded-md"
          data-action="workspace-menu"
          data-workspace={base64Encode(props.directory)}
          aria-label={props.language.t("common.moreOptions")}
        />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          onCloseAutoFocus={(event) => {
            if (!props.pendingRename()) return
            event.preventDefault()
            props.setPendingRename(false)
            props.openEditor(`workspace:${props.directory}`, props.workspaceValue())
          }}
        >
          <DropdownMenu.Item
            disabled={props.local()}
            onSelect={() => {
              props.setPendingRename(true)
              props.setMenuOpen(false)
            }}
          >
            <DropdownMenu.ItemLabel>{props.language.t("common.rename")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={props.local() || props.busy()}
            onSelect={() => props.showResetWorkspaceDialog(props.root, props.directory)}
          >
            <DropdownMenu.ItemLabel>{props.language.t("common.reset")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={props.local() || props.busy()}
            onSelect={() => props.showDeleteWorkspaceDialog(props.root, props.directory)}
          >
            <DropdownMenu.ItemLabel>{props.language.t("common.delete")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
    <Show when={!props.touch()}>
      <Tooltip value={props.language.t("command.session.new")} placement="top">
        <IconButtonV2
          icon={<IconV2 name="edit" size="small" />}
          variant="ghost"
          size="small"
          class="size-6 rounded-md opacity-0 pointer-events-none group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto"
          data-action="workspace-new-session"
          data-workspace={base64Encode(props.directory)}
          aria-label={props.language.t("command.session.new")}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            props.clearHoverProjectSoon()
            props.navigateToNewSession()
          }}
        />
      </Tooltip>
    </Show>
  </div>
)

// opencode-enhanced F3: draggable session row wrapper + droppable folder rows.
const DraggableSession = (props: { session: Session; children: JSX.Element }) => {
  const draggable = createDraggable(`session:${props.session.id}`)
  return (
    <div ref={draggable.ref} class="group/drag relative">
      <div
        {...draggable.dragActivators}
        class="absolute left-0 top-1/2 z-10 size-4 -translate-y-1/2 cursor-grab items-center justify-center rounded opacity-0 transition-opacity group-hover/drag:opacity-60 flex active:cursor-grabbing"
        style={{ "touch-action": "none" }}
        aria-hidden
      >
        <Icon name="chevron-grabber-vertical" size="small" class="text-icon-weak" />
      </div>
      {props.children}
    </div>
  )
}

const FolderSection = (props: {
  folder: SessionFolder
  count: number
  renaming: boolean
  onStartRename: () => void
  onRename: (name: string) => void
  onToggle: () => void
  onDelete: () => void
  language: ReturnType<typeof useLanguage>
  children: JSX.Element
}) => {
  const droppable = createDroppable(`folder:${props.folder.id}`)
  const dialog = useDialog()
  const [draft, setDraft] = createSignal(props.folder.name)
  const commit = () => props.onRename(draft())
  return (
    <div
      ref={droppable.ref}
      class="rounded-md transition-colors"
      classList={{ "bg-surface-raised-base-hover": droppable.isActiveDroppable }}
      data-folder-id={props.folder.id}
    >
      <Show
        when={!props.renaming}
        fallback={
          <div class="px-1 py-0.5">
            <TextField
              autofocus
              value={draft()}
              onChange={(value: string) => setDraft(value)}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Enter") commit()
                if (event.key === "Escape") props.onRename(props.folder.name)
              }}
              onBlur={commit}
            />
          </div>
        }
      >
        <div class="group/folder flex items-center gap-1 rounded-md py-0.5 pl-1 pr-2 hover:bg-surface-raised-base-hover">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1 text-left"
            onClick={props.onToggle}
            aria-label={props.folder.name}
          >
            <Icon
              name={props.folder.collapsed ? "chevron-right" : "chevron-down"}
              size="small"
              class="shrink-0 text-icon-weak"
            />
            {/* opencode-enhanced: folder names use the custom teal RGB(23,111,123). */}
            <span
              class="truncate text-13-medium"
              style={{ color: "rgb(23,111,123)" }}
            >
              {props.folder.name}
            </span>
            <span class="shrink-0 text-11-regular text-text-weak">{props.count}</span>
          </button>
          <div class="hidden shrink-0 items-center gap-0.5 group-hover/folder:flex">
            <IconButton
              icon="edit"
              variant="ghost"
              class="size-5 rounded"
              aria-label={props.language.t("common.rename")}
              onClick={(event) => {
                event.stopPropagation()
                setDraft(props.folder.name)
                props.onStartRename()
              }}
            />
            <IconButton
              icon="close"
              variant="ghost"
              class="size-5 rounded"
              aria-label={props.language.t("common.delete")}
              onClick={(event) => {
                event.stopPropagation()
                dialog.show(() => (
                  <DialogDeleteFolder
                    name={props.folder.name}
                    onConfirm={() => {
                      dialog.close()
                      props.onDelete()
                    }}
                  />
                ))
              }}
            />
          </div>
        </div>
      </Show>
      <Show when={!props.folder.collapsed}>
        <div class="flex flex-col gap-1 pl-3">{props.children}</div>
      </Show>
    </div>
  )
}

// opencode-enhanced: confirm dialog for deleting a folder (the sessions inside
// are NOT deleted - they just move out of the folder).
function DialogDeleteFolder(props: { name: string; onConfirm: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog title={language.t("sidebar.folders.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("sidebar.folders.delete.confirm", { name: props.name })}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={props.onConfirm}>
            {language.t("common.delete")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

const WorkspaceSessionList = (props: {
  slug: Accessor<string>
  mobile?: boolean
  ctx: WorkspaceSidebarContext
  showNew: Accessor<boolean>
  loading: Accessor<boolean>
  sessions: Accessor<Session[]>
  hasMore: Accessor<boolean>
  loadMore: () => Promise<void>
  language: ReturnType<typeof useLanguage>
}): JSX.Element => {
  const folders = createSessionFolders(() => decode64(props.slug()) ?? "")
  const [creating, setCreating] = createSignal(false)
  const [renaming, setRenaming] = createSignal<string>()
  const grouped = createMemo(() => folders.grouped(props.sessions()))

  const handleDragEnd = (event: DragEvent) => {
    const draggableId = String(event.draggable.id)
    if (!draggableId.startsWith("session:")) return
    const sessionID = draggableId.slice("session:".length)
    const droppableId = event.droppable ? String(event.droppable.id) : undefined
    if (droppableId?.startsWith("folder:")) {
      folders.assign(sessionID, droppableId.slice("folder:".length))
      return
    }
    if (droppableId === "ungrouped") folders.assign(sessionID, undefined)
  }

  const sessionItem = (session: Session) => (
    <DraggableSession session={session}>
      <SessionItem
        session={session}
        list={props.sessions()}
        navList={props.ctx.navList}
        slug={props.slug()}
        mobile={props.mobile}
        showChild
        sidebarExpanded={props.ctx.sidebarExpanded}
        clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
        prefetchSession={props.ctx.prefetchSession}
        archiveSession={props.ctx.archiveSession}
        folders={folders}
      />
    </DraggableSession>
  )

  return (
    <nav class="flex flex-col gap-1">
      <Show when={props.showNew()}>
        <NewSessionItem
          slug={props.slug()}
          mobile={props.mobile}
          sidebarExpanded={props.ctx.sidebarExpanded}
          clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
        />
      </Show>
      <Show when={props.loading()}>
        <SessionSkeleton />
      </Show>
      <DragDropProvider onDragEnd={handleDragEnd} collisionDetector={closestCenter}>
        <DragDropSensors />
        <Show
          when={!creating()}
          fallback={
            <div class="px-1">
              <TextField
                autofocus
                placeholder={props.language.t("sidebar.folders.newPlaceholder")}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== "Enter") return
                  const value = (event.currentTarget as HTMLInputElement).value
                  if (value.trim()) folders.create(value)
                  setCreating(false)
                }}
                onBlur={(event: FocusEvent) => {
                  const value = (event.currentTarget as HTMLInputElement).value
                  if (value.trim()) folders.create(value)
                  setCreating(false)
                }}
              />
            </div>
          }
        >
          <button
            type="button"
            class="flex w-full items-center gap-1 rounded-md px-2 py-0.5 text-left text-12-regular text-text-weak hover:bg-surface-raised-base-hover hover:text-text-base"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size="small" class="text-icon-weak" />
            {props.language.t("sidebar.folders.new")}
          </button>
        </Show>
        <For each={folders.folders()}>
          {(folder) => (
            <FolderSection
              folder={folder}
              count={(grouped().byFolder.get(folder.id) ?? []).length}
              renaming={renaming() === folder.id}
              onStartRename={() => setRenaming(folder.id)}
              onRename={(name) => {
                folders.rename(folder.id, name)
                setRenaming(undefined)
              }}
              onToggle={() => folders.toggleCollapsed(folder.id)}
              onDelete={() => folders.remove(folder.id)}
              language={props.language}
            >
              <For each={grouped().byFolder.get(folder.id) ?? []}>{sessionItem}</For>
            </FolderSection>
          )}
        </For>
        <UngroupedDropZone>
          <For each={grouped().ungrouped}>{sessionItem}</For>
        </UngroupedDropZone>
        <DragOverlay>
          <div class="rounded-md bg-surface-raised-stronger-non-alpha px-2 py-1 text-13-regular text-text-strong shadow-md">
            {props.language.t("sidebar.folders.dragging")}
          </div>
        </DragOverlay>
      </DragDropProvider>
      <Show when={props.hasMore()}>
        <div class="relative w-full py-1">
          <Button
            variant="ghost"
            class="flex w-full text-left justify-start text-14-regular text-text-weak pl-2 pr-10"
            size="large"
            onClick={(e: MouseEvent) => {
              void props.loadMore()
              ;(e.currentTarget as HTMLButtonElement).blur()
            }}
          >
            {props.language.t("common.loadMore")}
          </Button>
        </div>
      </Show>
    </nav>
  )
}

const UngroupedDropZone = (props: { children: JSX.Element }) => {
  const droppable = createDroppable("ungrouped")
  return (
    <div
      ref={droppable.ref}
      class="flex min-h-[8px] flex-col gap-1 rounded-md transition-colors"
      classList={{ "bg-surface-raised-base-hover": droppable.isActiveDroppable }}
    >
      {props.children}
    </div>
  )
}

export const SortableWorkspace = (props: {
  ctx: WorkspaceSidebarContext
  directory: string
  project: LocalProject
  sortNow: Accessor<number>
  mobile?: boolean
}): JSX.Element => {
  const navigate = useNavigate()
  const params = useParams()
  const serverSync = useServerSync()
  const queryOptions = useQueryOptions()
  const language = useLanguage()
  const sortable = createSortable(props.directory)
  const [workspaceStore, setWorkspaceStore] = serverSync().child(props.directory, { bootstrap: false })
  const [menu, setMenu] = createStore({
    open: false,
    pendingRename: false,
  })
  const slug = createMemo(() => base64Encode(props.directory))
  const sessions = createMemo(() => sortedRootSessions(workspaceStore, props.sortNow()))
  const local = createMemo(() => props.directory === props.project.worktree)
  const active = createMemo(() => pathKey(props.ctx.currentDir()) === pathKey(props.directory))
  const workspaceValue = createMemo(() => {
    const branch = workspaceStore.vcs?.branch
    const name = branch ?? getFilename(props.directory)
    return props.ctx.workspaceName(props.directory, props.project.id, branch) ?? name
  })
  const open = createMemo(() => props.ctx.workspaceExpanded(props.directory, local()))
  const boot = createMemo(() => open() || active())
  const count = createMemo(() => sessions()?.length ?? 0)
  const hasMore = createMemo(() => workspaceStore.sessionTotal > count())
  const fetching = useIsFetching(() => queryOptions().sessions(pathKey(props.directory)))
  const busy = createMemo(() => props.ctx.isBusy(props.directory))
  const loading = () => fetching() > 0 && count() === 0
  const touch = createMediaQuery("(hover: none)")
  const showNew = createMemo(() => !loading() && (touch() || count() === 0 || (active() && !params.id)))
  const loadMore = async () => {
    // opencode-enhanced: 10 per page so "load more" catches up quickly.
    setWorkspaceStore("limit", (limit) => (limit ?? 0) + 10)
  }

  const workspaceEditActive = createMemo(() => props.ctx.editorOpen(`workspace:${props.directory}`))
  const header = () => (
    <WorkspaceHeader
      local={local}
      busy={busy}
      open={open}
      directory={props.directory}
      language={language}
      branch={() => workspaceStore.vcs?.branch}
      workspaceValue={workspaceValue}
      workspaceEditActive={workspaceEditActive}
      InlineEditor={props.ctx.InlineEditor}
      renameWorkspace={props.ctx.renameWorkspace}
      setEditor={props.ctx.setEditor}
      projectId={props.project.id}
    />
  )

  const openWrapper = (value: boolean) => {
    props.ctx.setWorkspaceExpanded(props.directory, value)
    if (value) return
    if (props.ctx.editorOpen(`workspace:${props.directory}`)) props.ctx.closeEditor()
  }

  createEffect(() => {
    if (!boot()) return
    serverSync().child(props.directory, { bootstrap: true })
  })

  return (
    <div
      // @ts-ignore
      use:sortable
      classList={{
        "opacity-30": sortable.isActiveDraggable,
        "opacity-50 pointer-events-none": busy(),
      }}
    >
      <Collapsible variant="ghost" open={open()} class="shrink-0" onOpenChange={openWrapper}>
        <div class="py-1">
          <div
            class="group/workspace relative"
            data-component="workspace-item"
            data-workspace={base64Encode(props.directory)}
          >
            <div class="flex items-center gap-1">
              <Show
                when={workspaceEditActive()}
                fallback={
                  <Collapsible.Trigger
                    class={`flex items-center justify-between w-full pl-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover transition-[padding] duration-200 ${
                      menu.open ? "pr-16" : "pr-2"
                    } group-hover/workspace:pr-16 group-focus-within/workspace:pr-16`}
                    data-action="workspace-toggle"
                    data-workspace={base64Encode(props.directory)}
                  >
                    {header()}
                  </Collapsible.Trigger>
                }
              >
                <div
                  class={`flex items-center justify-between w-full pl-2 py-1.5 rounded-md transition-[padding] duration-200 ${
                    menu.open ? "pr-16" : "pr-2"
                  } group-hover/workspace:pr-16 group-focus-within/workspace:pr-16`}
                >
                  {header()}
                </div>
              </Show>
              <WorkspaceActions
                directory={props.directory}
                local={local}
                busy={busy}
                menuOpen={() => menu.open}
                pendingRename={() => menu.pendingRename}
                setMenuOpen={(open) => setMenu("open", open)}
                setPendingRename={(value) => setMenu("pendingRename", value)}
                sidebarHovering={props.ctx.sidebarHovering}
                touch={touch}
                language={language}
                workspaceValue={workspaceValue}
                openEditor={props.ctx.openEditor}
                showResetWorkspaceDialog={props.ctx.showResetWorkspaceDialog}
                showDeleteWorkspaceDialog={props.ctx.showDeleteWorkspaceDialog}
                root={props.project.worktree}
                clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
                navigateToNewSession={() => navigate(`/${slug()}/session`)}
              />
            </div>
          </div>
        </div>

        <Collapsible.Content>
          <WorkspaceSessionList
            slug={slug}
            mobile={props.mobile}
            ctx={props.ctx}
            showNew={showNew}
            loading={loading}
            sessions={sessions}
            hasMore={hasMore}
            loadMore={loadMore}
            language={language}
          />
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

export const LocalWorkspace = (props: {
  ctx: WorkspaceSidebarContext
  project: LocalProject
  sortNow: Accessor<number>
  mobile?: boolean
}): JSX.Element => {
  const serverSync = useServerSync()
  const queryOptions = useQueryOptions()
  const language = useLanguage()
  const workspace = createMemo(() => {
    const [store, setStore] = serverSync().child(props.project.worktree)
    return { store, setStore }
  })
  const slug = createMemo(() => base64Encode(props.project.worktree))
  const sessions = createMemo(() => sortedRootSessions(workspace().store, props.sortNow()))
  const count = createMemo(() => sessions()?.length ?? 0)
  const fetching = useIsFetching(() => queryOptions().sessions(pathKey(props.project.worktree)))
  const hasMore = createMemo(() => workspace().store.sessionTotal > count())
  const loading = () => fetching() > 0 && count() === 0
  const loadMore = async () => {
    workspace().setStore("limit", (limit) => (limit ?? 0) + 5)
    await serverSync().project.loadSessions(props.project.worktree)
  }

  return (
    <div
      ref={(el) => props.ctx.setScrollContainerRef(el, props.mobile)}
      // opencode-enhanced: visible scrollbar, and 200px bottom slack so a
      // right-click context menu on the last session/folder row renders fully
      // instead of clipping at the scroll container's bottom edge.
      class="size-full flex flex-col pt-2 pb-50 overflow-y-auto [overflow-anchor:none]"
    >
      <WorkspaceSessionList
        slug={slug}
        mobile={props.mobile}
        ctx={props.ctx}
        showNew={() => false}
        loading={loading}
        sessions={sessions}
        hasMore={hasMore}
        loadMore={loadMore}
        language={language}
      />
    </div>
  )
}
