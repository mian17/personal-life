// @life/ui barrel — components are exported from later modules.
export { Button } from './components/button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/button';

export { ButtonLink } from './components/button-link';
export type { ButtonLinkProps } from './components/button-link';

export { IconButton } from './components/icon-button';
export type { IconButtonProps, IconButtonVariant } from './components/icon-button';

export { Checkbox } from './components/checkbox';
export type { CheckboxProps } from './components/checkbox';

export { Input } from './components/input';
export type { InputProps } from './components/input';

export { FilePicker } from './components/file-picker';
export type { FilePickerProps } from './components/file-picker';

export { Textarea } from './components/textarea';
export type { TextareaProps, TextareaVariant } from './components/textarea';

export { Select } from './components/select';
export type { SelectOption, SelectProps } from './components/select';

export { Pill } from './components/pill';
export type { PillButtonType, PillProps, PillSize, PillTag } from './components/pill';

export { Card } from './components/card';
export type { CardProps } from './components/card';

export { Facts, FactsRow } from './components/facts';
export type { FactsProps, FactsRowProps } from './components/facts';

export { Kpi } from './components/kpi';
export type { KpiProps } from './components/kpi';

export { StatusText } from './components/status-text';
export type { StatusTextProps } from './components/status-text';

export { LocalTime } from './components/local-time';
export type { LocalTimeProps } from './components/local-time';

export { ConfirmButton } from './components/confirm-button';
export type { ConfirmButtonProps } from './components/confirm-button';

export { ThemeToggle } from './components/theme-toggle';
export type { ThemeToggleProps } from './components/theme-toggle';

export { Switch } from './components/switch';
export type { SwitchProps } from './components/switch';

export { IconLink } from './components/icon-link';
export type { IconLinkProps, IconLinkVariant } from './components/icon-link';

export { SettingsLink } from './components/settings-link';
export type { SettingsLinkProps } from './components/settings-link';

export { PageShell } from './components/page-shell';
export type { PageShellProps } from './components/page-shell';

export { NavBar } from './components/nav-bar';
export type { NavBarProps } from './components/nav-bar';

export { PageTitle } from './components/page-title';
export type { PageTitleProps } from './components/page-title';

export { FabLink } from './components/fab-link';
export type { FabLinkProps } from './components/fab-link';

export { FabMenu } from './components/fab-menu';
export type { FabMenuProps } from './components/fab-menu';

export { EditorToolbar } from './components/editor-toolbar';
export type { EditorToolbarProps, EditorToolbarBack } from './components/editor-toolbar';

export { EditorScreen } from './components/editor-screen';
export type { EditorScreenProps } from './components/editor-screen';

export { EmptyState } from './components/empty-state';
export type { EmptyStateProps } from './components/empty-state';

export { List } from './components/list';
export type { ListProps } from './components/list';

export { ListItem } from './components/list-item';
export type {
  ListItemProps,
  ListItemSize,
  ListItemTone,
  ListItemVariant,
} from './components/list-item';

export { TagFilterNav } from './components/tag-filter-nav';
export type { TagFilterNavProps, TagFilterItem } from './components/tag-filter-nav';

export { AlertBanner } from './components/alert-banner';
export type { AlertBannerProps, AlertBannerTone } from './components/alert-banner';

export { SearchField } from './components/search-field';
export type { SearchFieldProps } from './components/search-field';

export { Autosuggest } from './components/autosuggest';
export type { AutosuggestOption, AutosuggestProps } from './components/autosuggest';

export { PillGroup } from './components/pill-group';
export type { PillGroupProps } from './components/pill-group';

export { Segmented, Tab, TabBar } from './components/tab-bar';
export type { Segment, SegmentedProps, TabProps, TabBarProps } from './components/tab-bar';

export { PageActions } from './components/page-actions';
export type { PageActionsProps } from './components/page-actions';

export { Stack } from './components/stack';
export { Row } from './components/row';
export { EditorStack } from './components/editor-stack';
export type { EditorStackProps } from './components/editor-stack';
export type { RowProps } from './components/row';
export type { StackGap, StackProps } from './components/stack';

export { Section } from './components/section';
export type { SectionHeadingLevel, SectionProps } from './components/section';

export { SettingsRow } from './components/settings-row';
export type { SettingsRowProps } from './components/settings-row';

export { SettingsBlock } from './components/settings-block';
export type { SettingsBlockProps } from './components/settings-block';

export { TagCombobox } from './components/tag-combobox';
export type { TagComboboxProps, TagOption } from './components/tag-combobox';

export { TagManager } from './components/tag-manager';
export type { TagManagerProps } from './components/tag-manager';

export { DueDatePill, dueDateState, todayIso } from './components/due-date-pill';
export { dueDay, isoWeekday, localTimePart, todayIsoInZone, weekdayShort, WEEKDAY_SHORT } from './lib/date-parts';
export type { DueDatePillProps, DueDateState } from './components/due-date-pill';

export { DueDate } from './components/due-date';
export type { DueDateProps, DueDateTone } from './components/due-date';

export { ListManager } from './components/list-manager';
export type { ListManagerProps, TodoListOption } from './components/list-manager';

export { Menu, MenuItem } from './components/menu';
export type { MenuItemProps, MenuProps } from './components/menu';

export { TrashBlock } from './components/trash-block';
export type { TrashBlockItem, TrashBlockProps, TrashFormAction } from './components/trash-block';

export { ManagerBlock } from './components/manager-block';
export type { ManagerBlockProps } from './components/manager-block';

export { ListShell } from './components/list-shell';
export type { ListShellProps } from './components/list-shell';

export { EditorChrome } from './components/editor-chrome';
export type { EditorChromeProps, EditorChromeTagPicker } from './components/editor-chrome';

export { MatrixBlock } from './components/matrix-block';
export type { MatrixBlockProps, MatrixQuadrant, MatrixTone } from './components/matrix-block';

export { Snackbar } from './components/snackbar';
export type { SnackbarProps } from './components/snackbar';

export { SnackbarProvider, useSnackbar } from './components/snackbar-provider';
export type { SnackbarApi, SnackbarOptions } from './components/snackbar-provider';

export { Dialog } from './components/dialog';
export type { DialogProps } from './components/dialog';

export { FeedbackForm } from './components/feedback-form';
export type { FeedbackFormProps } from './components/feedback-form';

export { FEEDBACK_TYPES } from './components/feedback-types';

export { FeedbackNavItem } from './components/feedback-nav-item';
export type { FeedbackNavItemProps, FeedbackNavItemVariant } from './components/feedback-nav-item';

export { FEEDBACK_STATUSES, feedbackStatusOption } from './components/feedback-status';
export type { FeedbackStatusOption, FeedbackStatusToken } from './components/feedback-status';

export { BarChart, visibleTickIndexes } from './components/bar-chart';
export type { BarChartBucket, BarChartProps } from './components/bar-chart';
export { ProgressBar } from './components/progress-bar';
export type { ProgressBarProps } from './components/progress-bar';

export { cx } from './lib/cx';
export type { ClassValue } from './lib/cx';

export {
  dueDateLabel,
  formatDate,
  formatDayMonth,
  formatLongDate,
  formatNoteMeta,
  formatWeekday,
} from './lib/format-date';
