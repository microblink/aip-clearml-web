import {ChangeDetectorRef, Component, effect, inject, OnDestroy, OnInit, signal, TemplateRef, ViewChild} from '@angular/core';
import {CommonModule} from '@angular/common';
import {combineLatest, Observable, Subscription} from 'rxjs';
import {Store} from '@ngrx/store';
import {distinctUntilChanged, filter, map, take, tap, withLatestFrom} from 'rxjs/operators';
import {isEqual} from 'lodash-es';
import {
  createMultiSingleValuesChart,
  createMultiSingleValuesMultiChart,
  mergeMultiMetrics,
  mergeMultiMetricsGroupedVariant,
  prepareGraph
} from '@common/tasks/tasks.utils';
import {
  getGlobalLegendData,
  getMultiScalarCharts,
  getMultiSingleScalars,
  resetExperimentMetrics,
  setExperimentHistogram,
  setExperimentMetricsSearchTerm,
  setExperimentMultiScalarSingleValue,
  setExperimentSettings,
  setSelectedExperiments
} from '../../actions/experiments-compare-charts.actions';
import {
  selectCompareTasksScalarCharts,
  selectExperimentMetricsSearchTerm,
  selectGlobalLegendData,
  selectMultiSingleValues,
  selectSelectedExperiments,
  selectSelectedExperimentSettings
} from '../../reducers';
import {ScalarKeyEnum} from '~/business-logic/model/events/scalarKeyEnum';
import {GroupByCharts, groupByCharts, setChartSettings} from '@common/experiments/actions/common-experiment-output.actions';
import {ExtData, ExtFrame, ExtLayout} from '@common/shared/single-graph/plotly-graph-base';
import {RefreshService} from '@common/core/services/refresh.service';
import {selectRouterParams} from '@common/core/reducers/router-reducer';
import {ExperimentGraphsComponent} from '@common/shared/experiment-graphs/experiment-graphs.component';
import {ReportCodeEmbedService} from '~/shared/services/report-code-embed.service';
import {ActivatedRoute, Router} from '@angular/router';
import {EntityTypeEnum} from '~/shared/constants/non-common-consts';
import {smoothTypeEnum, SmoothTypeEnum} from '@common/shared/single-graph/single-graph.utils';
import {ExperimentCompareSettings} from '@common/experiments-compare/reducers/experiments-compare-charts.reducer';
import {
  selectCompareMetricVariants,
  selectCompareSelectedMetrics,
  selectShowCompareScalarSettings,
  selectSplitSize
} from '@common/experiments/reducers';
import {
  getCustomMetricsPerType,
  toggleCompareScalarSettings
} from '@common/experiments/actions/common-experiments-view.actions';
import {MetricVariants} from '~/business-logic/model/events/metricVariants';
import {GroupedList} from '@common/tasks/tasks.model';
import {
  buildMetricsList,
  SelectableGroupedFilterListComponent
} from '@common/shared/ui-components/data/selectable-grouped-filter-list/selectable-grouped-filter-list.component';
import {MetricVariantResult} from '~/business-logic/model/projects/metricVariantResult';
import {EventTypeEnum} from '~/business-logic/model/events/eventTypeEnum';
import {MatSidenavModule} from '@angular/material/sidenav';
import {PushPipe} from '@ngrx/component';
import {GraphSettingsBarComponent} from '@common/shared/experiment-graphs/graph-settings-bar/graph-settings-bar.component';
import {MatMenuModule, MatMenuTrigger} from '@angular/material/menu';
import {ClickStopPropagationDirective} from '@common/shared/ui-components/directives/click-stop-propagation.directive';
import {ChooseColorDirective} from '@common/shared/ui-components/directives/choose-color/choose-color.directive';
import {ExperimentSettings} from '@common/experiments/reducers/experiment-output.reducer';
import {selectRouterProjectId} from '@common/core/reducers/projects.reducer';
import {ColorHashService} from '@common/shared/services/color-hash/color-hash.service';
import {rgbList2Hex} from '@common/shared/services/color-hash/color-hash.utils';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatSliderModule} from '@angular/material/slider';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {ApiTasksService} from '~/business-logic/api-services/tasks.service';
import {MatDialog} from '@angular/material/dialog';
import {ConfirmDialogComponent} from '@common/shared/ui-components/overlay/confirm-dialog/confirm-dialog.component';
import {FormsModule} from '@angular/forms';
import {ICONS} from '@common/constants';
import {
  applyCompareLegendLabels,
  applyCompareLegendLabelsToFrame,
  buildLegendRowMap,
  CompareScalarLegendMode,
  toLegendSettingsFromExperimentSettings
} from '@common/experiments-compare/shared/compare-scalar-legend-tags.util';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';


@Component({
  selector: 'sm-experiment-compare-scalar-charts',
  templateUrl: './experiment-compare-scalar-charts.component.html',
  styleUrls: ['./experiment-compare-scalar-charts.component.scss'],
  host: {
    '(window:beforeunload)': 'saveSettingsState()'
  },
  imports: [
    CommonModule,
    MatSidenavModule,
    SelectableGroupedFilterListComponent,
    PushPipe,
    GraphSettingsBarComponent,
    MatMenuModule,
    ClickStopPropagationDirective,
    ChooseColorDirective,
    ExperimentGraphsComponent,
    MatIconModule,
    MatButtonModule,
    MatSliderModule,
    MatCheckboxModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule
  ]
})
export class ExperimentCompareScalarChartsComponent implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  private readonly changeDetection = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refresh = inject(RefreshService);
  private readonly reportEmbed = inject(ReportCodeEmbedService);
  private readonly colorHash = inject(ColorHashService);
  private readonly tasksApi = inject(ApiTasksService);
  private readonly dialog = inject(MatDialog);

  protected metrics$ = this.store.select(selectCompareTasksScalarCharts)
    .pipe(
      filter(metrics => !!metrics),
      distinctUntilChanged()
    );
  protected settings$ = this.store.select(selectSelectedExperimentSettings);
  protected splitSize$ = this.store.select(selectSplitSize);
  protected singleValues$ = this.store.select(selectMultiSingleValues);
  protected routerParams$ = this.store.select(selectRouterParams).pipe(
    filter(params => params.ids !== undefined),
    distinctUntilChanged()
  );
  protected experiments$: Observable<{id: string; name?: string; tags?: string[]; systemTags?: string[]; project?: {id: string}}[]>;
  protected showSettingsBar = this.store.selectSignal(selectShowCompareScalarSettings);
  protected projectId = this.store.selectSignal<string>(selectRouterProjectId);
  public searchTerm$: Observable<string>;
  public highlightedRunId: string = null;
  public lineWidth = 2;
  public legendTagFilterDraft = '';
  readonly scalarLegendModeOptions: {value: CompareScalarLegendMode; label: string}[] = [
    {value: 'default', label: 'Task name (default)'},
    {value: 'appendTags', label: 'Append tags'},
    {value: 'tagsOnly', label: 'Tags only'}
  ];
  public experimentsColor: Record<string, string> = {};
  public hiddenRuns = new Set<string>();
  public renameValue = '';
  public icons = ICONS;
  @ViewChild('renameRunDialog') renameTemplate: TemplateRef<unknown>;
  private styleUpdateScheduled = false;

  private subs = new Subscription();

  public graphList: GroupedList = {};
  protected taskIds: string[];
  public graphs: Record<string, ExtFrame[]>;
  private rawGraphs: Record<string, ExtFrame[]>;
  private unlabeledScalarGraphs: Record<string, ExtFrame[]> | null = null;
  private unlabeledSingleValuesChart: ExtFrame | null = null;
  private singleValuesSplit: ExtFrame[];
  private lastGlobalLegendData: {
    id: string;
    tags?: string[];
    systemTags?: string[];
    name?: string;
  }[] | null = null;
  private metrics: GroupedList;
  groupByOptions = [
    {
      name: 'Metric',
      value: groupByCharts.metric
    },
    {
      name: 'Metric + Variant',
      value: groupByCharts.none
    }
  ];

  @ViewChild(ExperimentGraphsComponent) graphsComponent: ExperimentGraphsComponent;
  @ViewChild(MatMenuTrigger) trigger: MatMenuTrigger;
  private entityType: EntityTypeEnum;
  public modelsFeature: boolean;
  public singleValuesChart: ExtFrame | null = null;
  public settings: ExperimentCompareSettings = {} as ExperimentCompareSettings;
  private initialSettings = {
    groupBy: 'none',
    smoothWeight: 0,
    smoothSigma: 2,
    smoothType: smoothTypeEnum.any,
    xAxisType: ScalarKeyEnum.Iter,
    selectedMetricsScalar: [],
    showOriginals: true,
    lineWidth: 1,
    scalarLegendMode: 'default' as CompareScalarLegendMode,
    scalarLegendTagFilter: '',
    scalarLegendIncludeSystemTags: false
  };
  private originalSettings: ExperimentCompareSettings;
  public minimized = false;
  private selectedVariants: MetricVariants[];
  private originMetrics: MetricVariantResult[];
  private previousTaskIds: string[];
  private firstTime = true;
  private previousSelectedMetricsCols: MetricVariantResult[] = [];
  protected loading = signal(false);

  constructor() {
    this.modelsFeature = this.route.snapshot?.parent.data?.setAllProject;
    this.searchTerm$ = this.store.select(selectExperimentMetricsSearchTerm);

    this.experiments$ = combineLatest([
      this.store.select(selectGlobalLegendData),
      this.colorHash.getColorsObservable()
    ]).pipe(
      map(([experiments]) => experiments ?? []),
      map(experiments => [...experiments].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))),
      tap(experiments => {
        this.experimentsColor = experiments.reduce((acc, exp) => {
          acc[exp.id] = rgbList2Hex(this.colorHash.initColor(`${exp.name}-${exp.id}`));
          return acc;
        }, {} as Record<string, string>);
      })
    );

    effect(() => {
      if (this.showSettingsBar()) {
        this.trigger.openMenu();
      }
    });
  }

  ngOnInit() {
    this.minimized = this.route.snapshot.routeConfig.data?.minimized;
    this.entityType = this.route.snapshot.parent.parent.data.entityType;

    this.subs.add(combineLatest([this.metrics$, this.singleValues$])
      .subscribe(([metricsWrapped, singleValues]) => {
        const metrics = metricsWrapped?.metrics !== undefined ? (metricsWrapped.metrics || {}) : undefined;

        if (singleValues) {
          const visibles = this.graphsComponent?.singleValueGraph().at(0)?.chart.data.reduce((curr, data) => {
            curr[data.task] = data.visible;
            return curr;
          }, {}) ?? {};
          if (this.settings.groupBy === 'metric') {
            const singleValuesData = createMultiSingleValuesChart(singleValues, visibles);
            this.unlabeledSingleValuesChart = prepareGraph(
              singleValuesData.data,
              singleValuesData.layout as Partial<ExtLayout>,
              {},
              {type: 'singleValue'}
            );
            this.singleValuesSplit = undefined;
          } else {
            this.unlabeledSingleValuesChart = null;
            this.singleValuesSplit = createMultiSingleValuesMultiChart(singleValues);
          }
        } else {
          this.unlabeledSingleValuesChart = null;
          this.singleValuesSplit = undefined;
        }
        this.metrics = metrics;
        this.updateUnlabeledScalarGraphs(metrics, this.singleValuesSplit);
        this.applyLegendAndStyles();
        if (metrics !== undefined) {
          this.loading.set(false);
        }
        this.changeDetection.detectChanges();
      }));

    this.subs.add(this.store.select(selectGlobalLegendData).pipe(
      distinctUntilChanged((a, b) => isEqual(a ?? null, b ?? null))
    ).subscribe(data => {
      this.lastGlobalLegendData = data;
      this.applyLegendAndStyles();
    }));

    this.subs.add(this.routerParams$
      .pipe(distinctUntilChanged((prev, curr) => isEqual(prev, curr)))
      .pipe(withLatestFrom(
        this.store.select(selectCompareMetricVariants),
        this.store.select(selectSelectedExperiments)))
      .subscribe(([params, metrics, selectedExperiments]) => {
        if (!this.taskIds || this.taskIds.join(',') !== params.ids) {
          const previousTaskIds = this.taskIds;
          this.graphs = undefined;
          this.taskIds = params.ids.split(',').sort().filter(id => !!id);
          this.store.dispatch(setSelectedExperiments({selectedExperiments: this.taskIds}));
          this.hiddenRuns = new Set<string>();
          this.highlightedRunId = null;
          if (params.ids.length > 0 && (metrics === null || metrics.length === 0 || (metrics.length > 0 && previousTaskIds !== undefined) || !isEqual(selectedExperiments, this.taskIds))) {
            this.store.dispatch(getCustomMetricsPerType({ids: this.taskIds, metricsType: EventTypeEnum.TrainingStatsScalar, isModel: this.entityType === EntityTypeEnum.model}));
          }
        }
      }));

    this.subs.add(this.store.select(selectCompareSelectedMetrics('scalars'))
      .pipe(
        filter(metrics => !!metrics && this.minimized),
        distinctUntilChanged((prev, curr) => isEqual(prev, curr)))
      .subscribe(selectedMetrics => {
        const metricsVariants = selectedMetrics.filter(m => !m.hidden).reduce((acc, curr) => {
          const currMetric = curr.metricName.replace(' Summary', 'Summary');
          if (acc[currMetric]) {
            acc[currMetric].push(curr.variantName);
          } else {
            acc[currMetric] = [curr.variantName];
          }
          return acc;
        }, {} as Record<string, string[]>);

        const newSelectedMetricsScalar = selectedMetrics.filter(m => !m.hidden).map(m => m.metricName + m.variantName);
        const VariantWasAdded = newSelectedMetricsScalar?.length > this.settings.selectedMetricsScalar?.length;
        this.settings.selectedMetricsScalar = newSelectedMetricsScalar;
        const variants = Object.entries(metricsVariants).map(([metricName, variants]) => ({metric: metricName, variants}));
        this.selectedVariants = variants;
        if (variants.length > 0 && this.taskIds.length > 0) {
          if (this.firstTime || VariantWasAdded && this.missingVariantGraphInStore()) {
            this.firstTime = false;
            this.store.dispatch(getMultiScalarCharts({taskIds: this.taskIds, entity: this.entityType, metrics: variants, xAxisType: this.settings.xAxisType}));
          }
          this.store.dispatch(getMultiSingleScalars({taskIds: this.taskIds, entity: this.entityType, metrics: variants}));
        }
      }));

    this.subs.add(this.refresh.tick
      .pipe(filter(auto => auto !== null && this.graphs !== null && this.taskIds.length > 0))
      .subscribe(autoRefresh => {
        this.store.dispatch(getCustomMetricsPerType({ids: this.taskIds, metricsType: EventTypeEnum.TrainingStatsScalar, isModel: this.entityType === EntityTypeEnum.model}));
        this.store.dispatch(getMultiScalarCharts({taskIds: this.taskIds, entity: this.entityType, metrics: this.selectedVariants, xAxisType: this.settings.xAxisType}));
        this.store.dispatch(getMultiSingleScalars({taskIds: this.taskIds, entity: this.entityType, metrics: this.selectedVariants, autoRefresh}));
      }));

    this.subs.add(this.settings$.pipe(take(1)).subscribe(settings => {
      this.originalSettings = settings;
      this.settings = settings ? {...this.initialSettings, ...settings, ...(this.settings ?? {})} : {...this.initialSettings, ...(this.settings ?? {})} as ExperimentCompareSettings;
      this.lineWidth = this.settings.lineWidth ?? 1;
      this.settings.lineWidth = this.lineWidth;
      this.legendTagFilterDraft = this.settings.scalarLegendTagFilter ?? '';
    }));

    this.subs.add(this.store.select(selectCompareMetricVariants)
      .pipe(
        filter(metrics => !!metrics),
        distinctUntilChanged((prev, curr) => isEqual(prev, curr) && this.taskIds === this.previousTaskIds)
      )
      .subscribe(metrics => {
        this.previousTaskIds = this.taskIds;
        this.originMetrics = metrics;
        this.graphList = buildMetricsList(metrics);

        if (!this.minimized) {
          let selectedMetricsCols: MetricVariantResult[];
          if (this.settings.selectedMetricsScalar?.length > 0) {
            selectedMetricsCols = this.settings.groupBy === groupByCharts.none ?
              metrics.filter(metric => this.settings.selectedMetricsScalar.includes(metric.metric + metric.variant)) :
              metrics.filter(metric => this.settings.selectedMetricsScalar.includes(metric.metric) || this.settings.selectedMetricsScalar.includes(metric.metric + metric.variant));
            if (this.settings.groupBy === 'none') {
              this.settings = this.selectAllChildren();
            }
            this.settings.selectedMetricsScalar = Array.from(new Set([
              ...this.settings.selectedMetricsScalar,
              ...selectedMetricsCols.map(metric => metric.metric)
            ]));
          } else {
            if (this.settings.groupBy === 'metric') {
              const uniqueMetrics = Array.from(new Set(metrics.map(a => a.metric)));
              const FifthMetric = uniqueMetrics[8] ?? uniqueMetrics.at(-1);
              selectedMetricsCols = metrics.slice(0, metrics.findIndex(metric => metric.metric === FifthMetric) ?? 8);
            } else {
              selectedMetricsCols = metrics.slice(0, 8);
            }
            this.settings.selectedMetricsScalar = [
              ...selectedMetricsCols.map(metric => metric.metric + metric.variant),
              ...Array.from(new Set(selectedMetricsCols.map(metric => metric.metric)))
            ];
          }
          this.selectedVariants = this.buildMetricVariants(selectedMetricsCols);
        }
        if (this.taskIds.length > 0) {
          this.store.dispatch(getMultiScalarCharts({taskIds: this.taskIds, entity: this.entityType, metrics: this.selectedVariants, xAxisType: this.settings.xAxisType}));
          this.store.dispatch(getMultiSingleScalars({taskIds: this.taskIds, entity: this.entityType, metrics: this.selectedVariants}));
        }
        if (this.selectedVariants?.length === 0) {
          this.store.dispatch(setExperimentHistogram({axisType: this.settings.xAxisType, payload: {}}));
          this.store.dispatch(setExperimentMultiScalarSingleValue({name: null}));
          this.singleValuesChart = null;
          this.singleValuesSplit = [];
          this.unlabeledScalarGraphs = {};
          this.graphs = {};
          this.unlabeledSingleValuesChart = null;
        }
        this.changeDetection.markForCheck();
      }));

  }

  buildMetricVariants = (selectedMetricsCols: MetricVariantResult[]) => {
    const selectedMetricsVariants = selectedMetricsCols.reduce((acc, curr) => {
      const currMetric = curr.metric.replace(' Summary', 'Summary');
      if (this.settings.groupBy === 'metric') {
        acc[currMetric] = [];
      } else {
        if (acc[currMetric]) {
          acc[currMetric].push(curr.variant);
        } else {
          acc[currMetric] = [curr.variant];
        }
      }
      return acc;
    }, {} as Record<string, string[]>);

    return Object.entries(selectedMetricsVariants).map(([metricName, variants]) => ({metric: metricName, variants}));
  };

  private updateUnlabeledScalarGraphs(metrics: GroupedList, singleValues?: ExtFrame[]) {
    let merged = {};
    if (metrics || singleValues) {
      merged = this.settings.groupBy === 'metric'
        ? mergeMultiMetricsGroupedVariant(metrics)
        : {...mergeMultiMetrics(metrics), ...(singleValues?.length > 0 && {' Summary': singleValues})};
    }
    const graphsChanged = this.unlabeledScalarGraphs === null || !isEqual(merged, this.unlabeledScalarGraphs);
    if (graphsChanged) {
      this.unlabeledScalarGraphs = merged;
    }
  }

  private prepareGraphsAndUpdate(metrics: GroupedList, singleValues?: ExtFrame[]) {
    this.updateUnlabeledScalarGraphs(metrics, singleValues);
    this.applyLegendAndStyles();
    if (metrics !== undefined) {
      this.loading.set(false);
    }
    this.changeDetection.detectChanges();
  }

  private applyLegendAndStyles() {
    const legendMap = buildLegendRowMap(this.lastGlobalLegendData);
    const legendSettings = toLegendSettingsFromExperimentSettings(this.settings);
    const source = this.unlabeledScalarGraphs ?? {};
    this.rawGraphs = applyCompareLegendLabels(source, legendSettings, legendMap);
    const legendSingle = applyCompareLegendLabelsToFrame(this.unlabeledSingleValuesChart, legendSettings, legendMap);
    this.applyGraphStyles(legendSingle);
  }

  changeScalarLegendMode(mode: CompareScalarLegendMode) {
    this.settings = {...this.settings, scalarLegendMode: mode};
    this.applyLegendAndStyles();
    this.saveSettingsState();
  }

  changeScalarLegendIncludeSystemTags(include: boolean) {
    this.settings = {...this.settings, scalarLegendIncludeSystemTags: include};
    this.applyLegendAndStyles();
    this.saveSettingsState();
  }

  commitScalarLegendTagFilter() {
    const next = (this.legendTagFilterDraft ?? '').trim();
    if (next === (this.settings.scalarLegendTagFilter ?? '')) {
      return;
    }
    this.settings = {...this.settings, scalarLegendTagFilter: next};
    this.applyLegendAndStyles();
    this.saveSettingsState();
  }

  private buildNestedListWithoutChildren(metricsList: MetricVariantResult[]) {
    return metricsList.reduce((acc, metric) => {
      acc[metric.metric] = {};
      return acc;
    }, {} as GroupedList);
  }

  ngOnDestroy() {
    this.store.dispatch(setExperimentMetricsSearchTerm({searchTerm: ''}));
    this.saveSettingsState();
    this.subs.unsubscribe();
    this.resetMetrics();
  }

  metricSelected(id) {
    this.graphsComponent.scrollToGraph(id);
  }

  selectedListChanged(selectedList: string[]) {
    if (isEqual(selectedList, this.settings.selectedMetricsScalar)) {
      return;
    }
    this.settings = {...this.settings, selectedMetricsScalar: selectedList ?? []};
    if (!this.minimized) {
      const selectedMetricsCols = this.settings.groupBy === groupByCharts.none ?
        this.originMetrics.filter(metric => this.settings.selectedMetricsScalar.includes(metric.metric + metric.variant)) :
        this.originMetrics.filter(metric => this.settings.selectedMetricsScalar.includes(metric.metric));
      const newSelectedVariants = this.buildMetricVariants(selectedMetricsCols);
      const isAdded = selectedMetricsCols.length > this.previousSelectedMetricsCols.length ||
        selectedMetricsCols.filter(m => m.metric === ' Summary').length !== this.previousSelectedMetricsCols.filter(m => m.metric === ' Summary').length;
      this.selectedVariants = newSelectedVariants;
      if (this.settings.groupBy === groupByCharts.metric) {
        this.cleanVariantsWithoutMetric(selectedMetricsCols);
      }
      if (this.selectedVariants.length > 0) {
        if (isAdded && this.taskIds.length > 0) {
          this.loading.set(true);
          this.store.dispatch(getMultiScalarCharts({taskIds: this.taskIds, entity: this.entityType, metrics: this.selectedVariants, xAxisType: this.settings.xAxisType}));
          this.store.dispatch(getMultiSingleScalars({taskIds: this.taskIds, entity: this.entityType, metrics: this.selectedVariants}));
        }
      } else {
        this.settings = {...this.settings, selectedMetricsScalar: []};
      }
      this.previousSelectedMetricsCols = selectedMetricsCols;
    }
  }

  cleanVariantsWithoutMetric(selectedMetricsCols: MetricVariantResult[]) {
    const allRealVariants = selectedMetricsCols.map(metric => [`${metric.metric}${metric.variant}`, metric.metric]).flat(2);
    this.settings.selectedMetricsScalar = this.settings.selectedMetricsScalar.filter(m => allRealVariants.includes(m));
  }

  searchTermChanged(searchTerm: string) {
    this.store.dispatch(setExperimentMetricsSearchTerm({searchTerm}));
  }

  resetMetrics() {
    this.store.dispatch(resetExperimentMetrics());
  }

  changeSmoothness($event: number) {
    this.settings = {...this.settings, smoothWeight: $event};
  }

  changeSigma($event: number) {
    this.settings = {...this.settings, smoothSigma: $event};
  }

  changeSmoothType($event: SmoothTypeEnum) {
    this.settings = {
      ...this.settings, smoothType: $event,
      ...(this.settings.smoothType !== smoothTypeEnum.gaussian && {smoothSigma: 2})
    };
  }

  changeShowOriginals($event: boolean) {
    this.settings = {...this.settings, showOriginals: $event};
  }

  changeLineWidth(width: number) {
    const numericWidth = Math.round((Number.isFinite(Number(width)) ? Number(width) : this.lineWidth ?? 2) * 10) / 10;
    const boundedWidth = Math.min(7, Math.max(0.3, numericWidth));
    this.lineWidth = boundedWidth;
    this.settings = {...this.settings, lineWidth: boundedWidth};
    this.updateGraphStyles();
  }

  changeLineWidthFromInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.changeLineWidth(Number(value));
  }

  changeXAxisType($event: ScalarKeyEnum) {
    this.settings = {...this.settings, xAxisType: $event};
    if (this.taskIds.length > 0) {
      this.store.dispatch(getMultiScalarCharts({taskIds: this.taskIds, entity: this.entityType, metrics: this.selectedVariants, xAxisType: this.settings.xAxisType}));
    }
  }

  changeGroupBy(groupBy: GroupByCharts) {
    this.settings = {...this.settings, groupBy};
    if (groupBy === 'none') {
      this.loading.set(true);
    } else {
      this.prepareGraphsAndUpdate(this.metrics, this.singleValuesSplit);
    }
    this.graphList = buildMetricsList(this.originMetrics);
    const selectedMetricsWithoutVariants = this.selectedVariants.map(metric => ({metric: metric.metric, variants: []}));
    if (groupBy === 'none') {
      this.settings = this.selectAllChildren();
    }
    if (this.taskIds.length > 0) {
      this.store.dispatch(getMultiScalarCharts({
        taskIds: this.taskIds,
        entity: this.entityType,
        metrics: this.settings.groupBy === 'none' ? this.selectedVariants : selectedMetricsWithoutVariants,
        xAxisType: this.settings.xAxisType
      }));
      this.store.dispatch(getMultiSingleScalars({
        taskIds: this.taskIds,
        entity: this.entityType,
        metrics: this.settings.groupBy === 'none' ? this.selectedVariants : selectedMetricsWithoutVariants
      }));
    }
  }

  highlightRun(id: string) {
    if (this.highlightedRunId === id) {
      return;
    }
    this.highlightedRunId = id;
    this.updateGraphStyles();
  }

  clearHighlight() {
    if (!this.highlightedRunId) {
      return;
    }
    this.highlightedRunId = null;
    this.updateGraphStyles();
  }

  setRunVisibility(runId: string, isVisible: boolean) {
    const hiddenRuns = new Set(this.hiddenRuns);
    if (isVisible) {
      hiddenRuns.delete(runId);
    } else {
      hiddenRuns.add(runId);
    }
    this.hiddenRuns = hiddenRuns;
    this.updateGraphStyles();
  }

  viewRun(run: {id: string; project?: {id: string}}) {
    const projectId = run.project?.id ?? this.projectId();
    const url = `/projects/${projectId}/tasks/${run.id}/execution`;
    window.open(url, '_blank');
  }

  renameRun(run: {id: string; name?: string; tags?: string[]; systemTags?: string[]; project?: {id: string}}) {
    this.renameValue = run.name ?? '';
    const ref = this.dialog.open<ConfirmDialogComponent, unknown, {isConfirmed: boolean} | boolean>(ConfirmDialogComponent, {
      data: {
        title: 'Rename run',
        template: this.renameTemplate,
        templateContext: {$implicit: run},
        yes: 'Save',
        no: 'Cancel',
        width: 500,
        containerClass: 'neat',
        headerClass: 'no-uppercase',
        buttonsClass: 'align-end'
      },
      panelClass: 'rename-run-dialog'
    });
    ref.afterClosed().subscribe(result => {
      if ((result as {isConfirmed?: boolean})?.isConfirmed || result === true) {
        const newName = this.renameValue?.trim();
        if (newName && newName !== (run.name ?? '')) {
          this.tasksApi.tasksUpdate({task: run.id, name: newName}).subscribe(() => {
            this.refreshLegendData();
          });
        }
      }
      this.renameValue = '';
    });
  }

  deleteRun(run: {id: string; name?: string; tags?: string[]; systemTags?: string[]; project?: {id: string}}) {
    const displayName = run.name?.trim() || run.id;
    const ref = this.dialog.open<ConfirmDialogComponent, unknown, {isConfirmed: boolean} | boolean>(ConfirmDialogComponent, {
      data: {
        title: 'Delete run',
        body: `Are you sure you want to delete "<b>${displayName}</b>"? This action cannot be undone.`,
        yes: 'Delete',
        no: 'Cancel',
        iconClass: 'al-ico-trash',
        width: 520,
        containerClass: 'neat',
        headerClass: 'no-uppercase',
        buttonsClass: 'align-end'
      },
      panelClass: 'rename-run-dialog'
    });
    ref.afterClosed().subscribe(result => {
      if ((result as {isConfirmed?: boolean})?.isConfirmed || result === true) {
        this.tasksApi.tasksDelete({task: run.id, force: true}).subscribe(() => {
          const remaining = (this.taskIds || []).filter(id => id !== run.id);
          this.taskIds = remaining;
          this.hiddenRuns.delete(run.id);
          this.router.navigate([{ids: remaining}], {
            relativeTo: this.route,
            replaceUrl: true,
            queryParamsHandling: 'preserve'
          });
          this.refreshLegendData(remaining);
        });
      }
    });
  }

  private refreshLegendData(ids = this.taskIds) {
    if (ids?.length > 0) {
      this.store.dispatch(getGlobalLegendData({ids, entity: this.entityType}));
    }
  }

  changeChartSettings($event: { id: string; changes: Partial<ExperimentSettings> }) {
    this.store.dispatch(setChartSettings({...$event, projectId: this.projectId()}));
  }

  selectAllChildren(force = false) {
    const newVariantsToSelect = [];
    Object.entries(this.graphList).forEach(([metric, variant]) => {
      if (this.settings.selectedMetricsScalar.includes(metric) && (this.settings.selectedMetricsScalar.filter(a => a.startsWith(metric)).length === 1 || force)) {
        Object.keys(variant).map(variantName => metric + variantName).forEach(variantPath => {
          if (!this.settings.selectedMetricsScalar.includes(variantPath)) {
            newVariantsToSelect.push(variantPath);
          }
        });
      }
    });
    return {...this.settings, selectedMetricsScalar: [...this.settings.selectedMetricsScalar, ...newVariantsToSelect]};
  }

  toggleSettingsBar() {
    this.store.dispatch(toggleCompareScalarSettings());
  }

  createEmbedCode(event: { metrics?: string[]; variants?: string[]; domRect: DOMRect; singleValues?: boolean }) {
    const entityType = this.entityType === EntityTypeEnum.model ? 'model' : 'task';
    this.reportEmbed.createCode({
      type: (event.singleValues || !event.metrics) ? 'single' : 'scalar',
      objects: (!!event.metrics || this.taskIds.length > 1) ? this.taskIds : [...this.taskIds, ''],
      objectType: entityType,
      ...event
    });
  }

  protected saveSettingsState() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {id, lastModified, selectedMetricsPlot, ...cleanSettings} = this.settings;
    if (!isEqual(cleanSettings, this.originalSettings)) {
      this.store.dispatch(setExperimentSettings({id: this.taskIds, changes: cleanSettings}));
    }
  }

  private updateGraphStyles() {
    if (this.styleUpdateScheduled) {
      return;
    }
    this.styleUpdateScheduled = true;
    requestAnimationFrame(() => {
      const legendMap = buildLegendRowMap(this.lastGlobalLegendData);
      const legendSettings = toLegendSettingsFromExperimentSettings(this.settings);
      const legendSingle = applyCompareLegendLabelsToFrame(this.unlabeledSingleValuesChart, legendSettings, legendMap);
      this.applyGraphStyles(legendSingle);
      this.styleUpdateScheduled = false;
    });
  }

  private styleTrace(trace: ExtData, frameTask: string, baseLineWidth: number, highlighted: string | null): ExtData {
    const taskId = trace.task || frameTask;
    const isHidden = this.hiddenRuns.has(taskId);
    const isHighlighted = !!(highlighted && taskId === highlighted);
    const effectiveVisible = isHidden ? false : (trace.visible !== false);
    const effectiveOpacity = isHidden ? 0 : highlighted ? (isHighlighted ? 1 : 0.3) : 1;
    const lw = highlighted ? (isHighlighted ? baseLineWidth + 2 : baseLineWidth) : baseLineWidth;
    const next: ExtData = {
      ...trace,
      opacity: effectiveOpacity,
      visible: effectiveVisible
    };
    if (trace.type === 'bar') {
      next.marker = {
        ...trace.marker,
        line: {...trace.marker?.line, width: lw}
      };
    } else {
      next.line = {...trace.line, width: lw};
    }
    return next;
  }

  private applyGraphStyles(legendAppliedSingle: ExtFrame | null) {
    const baseLineWidth = Math.min(7, Math.max(0.3, this.settings?.lineWidth ?? this.lineWidth ?? 2));
    this.lineWidth = baseLineWidth;
    const highlighted = this.highlightedRunId;
    const sourceGraphs = this.rawGraphs ?? {};
    this.graphs = Object.entries(sourceGraphs).reduce((acc, [metric, frames]) => {
      acc[metric] = frames?.map(frame => {
        const updatedData = frame.data?.map(trace =>
          this.styleTrace(trace, frame.task, baseLineWidth, highlighted)
        ) ?? [];
        return {...frame, data: updatedData};
      }) ?? [];
      return acc;
    }, {} as Record<string, ExtFrame[]>);

    if (legendAppliedSingle?.data) {
      this.singleValuesChart = {
        ...legendAppliedSingle,
        data: legendAppliedSingle.data.map(trace =>
          this.styleTrace(trace, legendAppliedSingle.task, baseLineWidth, highlighted)
        )
      };
    } else {
      this.singleValuesChart = null;
    }
    this.changeDetection.detectChanges();
  }

  private missingVariantGraphInStore() {
    const graphs = this.graphs ? Object.keys(this.graphs) : [];
    return this.settings.selectedMetricsScalar.filter(metric => !metric.startsWith(' Summary')).some(graph => !graphs.includes(graph));
  }
}
