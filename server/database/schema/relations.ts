import { relations } from 'drizzle-orm'
import { users } from './auth'
import {
  lessonCompetencies,
  lessonMaterials,
  lessonPhaseMaterials,
  lessonPhases,
  lessonTags,
  lessons,
} from './lessons'
import {
  materialAssets,
  materialCompetencies,
  materialGradeLevels,
  materialLearningGroups,
  materialRelations,
  materialSubjects,
  materialTags,
  materialTopics,
  materialVariants,
  materials,
} from './materials'
import { series, seriesCompetencies, seriesMaterials, seriesTags } from './series'
import { competencies, learningGroups, subjects, tags, topics } from './taxonomy'
import { importLogs, importRunItems, importRuns } from './imports'
import { aiJobs } from './settings'

export const materialsRelations = relations(materials, ({ one, many }) => ({
  owner: one(users, { fields: [materials.ownerId], references: [users.id] }),
  variants: many(materialVariants),
  subjects: many(materialSubjects),
  topics: many(materialTopics),
  tags: many(materialTags),
  competencies: many(materialCompetencies),
  gradeLevels: many(materialGradeLevels),
  learningGroups: many(materialLearningGroups),
  relationsFrom: many(materialRelations, { relationName: 'relationsFrom' }),
  relationsTo: many(materialRelations, { relationName: 'relationsTo' }),
  lessonUsages: many(lessonMaterials),
  seriesUsages: many(seriesMaterials),
}))

export const materialVariantsRelations = relations(materialVariants, ({ one, many }) => ({
  material: one(materials, { fields: [materialVariants.materialId], references: [materials.id] }),
  assets: many(materialAssets),
}))

export const materialAssetsRelations = relations(materialAssets, ({ one }) => ({
  variant: one(materialVariants, {
    fields: [materialAssets.variantId],
    references: [materialVariants.id],
  }),
}))

export const materialRelationsRelations = relations(materialRelations, ({ one }) => ({
  fromMaterial: one(materials, {
    fields: [materialRelations.fromMaterialId],
    references: [materials.id],
    relationName: 'relationsFrom',
  }),
  toMaterial: one(materials, {
    fields: [materialRelations.toMaterialId],
    references: [materials.id],
    relationName: 'relationsTo',
  }),
}))

export const materialSubjectsRelations = relations(materialSubjects, ({ one }) => ({
  material: one(materials, { fields: [materialSubjects.materialId], references: [materials.id] }),
  subject: one(subjects, { fields: [materialSubjects.subjectId], references: [subjects.id] }),
}))

export const materialTopicsRelations = relations(materialTopics, ({ one }) => ({
  material: one(materials, { fields: [materialTopics.materialId], references: [materials.id] }),
  topic: one(topics, { fields: [materialTopics.topicId], references: [topics.id] }),
}))

export const materialTagsRelations = relations(materialTags, ({ one }) => ({
  material: one(materials, { fields: [materialTags.materialId], references: [materials.id] }),
  tag: one(tags, { fields: [materialTags.tagId], references: [tags.id] }),
}))

export const materialCompetenciesRelations = relations(materialCompetencies, ({ one }) => ({
  material: one(materials, {
    fields: [materialCompetencies.materialId],
    references: [materials.id],
  }),
  competency: one(competencies, {
    fields: [materialCompetencies.competencyId],
    references: [competencies.id],
  }),
}))

export const materialGradeLevelsRelations = relations(materialGradeLevels, ({ one }) => ({
  material: one(materials, {
    fields: [materialGradeLevels.materialId],
    references: [materials.id],
  }),
}))

export const materialLearningGroupsRelations = relations(materialLearningGroups, ({ one }) => ({
  material: one(materials, {
    fields: [materialLearningGroups.materialId],
    references: [materials.id],
  }),
  learningGroup: one(learningGroups, {
    fields: [materialLearningGroups.learningGroupId],
    references: [learningGroups.id],
  }),
}))

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  owner: one(users, { fields: [lessons.ownerId], references: [users.id] }),
  subject: one(subjects, { fields: [lessons.subjectId], references: [subjects.id] }),
  learningGroup: one(learningGroups, {
    fields: [lessons.learningGroupId],
    references: [learningGroups.id],
  }),
  topic: one(topics, { fields: [lessons.topicId], references: [topics.id] }),
  series: one(series, { fields: [lessons.seriesId], references: [series.id] }),
  phases: many(lessonPhases),
  materials: many(lessonMaterials),
  competencies: many(lessonCompetencies),
  tags: many(lessonTags),
}))

export const lessonPhasesRelations = relations(lessonPhases, ({ one, many }) => ({
  lesson: one(lessons, { fields: [lessonPhases.lessonId], references: [lessons.id] }),
  materials: many(lessonPhaseMaterials),
}))

export const lessonPhaseMaterialsRelations = relations(lessonPhaseMaterials, ({ one }) => ({
  phase: one(lessonPhases, {
    fields: [lessonPhaseMaterials.phaseId],
    references: [lessonPhases.id],
  }),
  material: one(materials, {
    fields: [lessonPhaseMaterials.materialId],
    references: [materials.id],
  }),
  variant: one(materialVariants, {
    fields: [lessonPhaseMaterials.variantId],
    references: [materialVariants.id],
  }),
}))

export const lessonMaterialsRelations = relations(lessonMaterials, ({ one }) => ({
  lesson: one(lessons, { fields: [lessonMaterials.lessonId], references: [lessons.id] }),
  material: one(materials, { fields: [lessonMaterials.materialId], references: [materials.id] }),
  variant: one(materialVariants, {
    fields: [lessonMaterials.variantId],
    references: [materialVariants.id],
  }),
}))

export const lessonCompetenciesRelations = relations(lessonCompetencies, ({ one }) => ({
  lesson: one(lessons, { fields: [lessonCompetencies.lessonId], references: [lessons.id] }),
  competency: one(competencies, {
    fields: [lessonCompetencies.competencyId],
    references: [competencies.id],
  }),
}))

export const lessonTagsRelations = relations(lessonTags, ({ one }) => ({
  lesson: one(lessons, { fields: [lessonTags.lessonId], references: [lessons.id] }),
  tag: one(tags, { fields: [lessonTags.tagId], references: [tags.id] }),
}))

export const seriesRelations = relations(series, ({ one, many }) => ({
  owner: one(users, { fields: [series.ownerId], references: [users.id] }),
  subject: one(subjects, { fields: [series.subjectId], references: [subjects.id] }),
  learningGroup: one(learningGroups, {
    fields: [series.learningGroupId],
    references: [learningGroups.id],
  }),
  topic: one(topics, { fields: [series.topicId], references: [topics.id] }),
  lessons: many(lessons),
  materials: many(seriesMaterials),
  competencies: many(seriesCompetencies),
  tags: many(seriesTags),
}))

export const seriesMaterialsRelations = relations(seriesMaterials, ({ one }) => ({
  series: one(series, { fields: [seriesMaterials.seriesId], references: [series.id] }),
  material: one(materials, { fields: [seriesMaterials.materialId], references: [materials.id] }),
  variant: one(materialVariants, {
    fields: [seriesMaterials.variantId],
    references: [materialVariants.id],
  }),
}))

export const seriesCompetenciesRelations = relations(seriesCompetencies, ({ one }) => ({
  series: one(series, { fields: [seriesCompetencies.seriesId], references: [series.id] }),
  competency: one(competencies, {
    fields: [seriesCompetencies.competencyId],
    references: [competencies.id],
  }),
}))

export const seriesTagsRelations = relations(seriesTags, ({ one }) => ({
  series: one(series, { fields: [seriesTags.seriesId], references: [series.id] }),
  tag: one(tags, { fields: [seriesTags.tagId], references: [tags.id] }),
}))

export const subjectsRelations = relations(subjects, ({ many }) => ({
  learningGroups: many(learningGroups),
  topics: many(topics),
  competencies: many(competencies),
}))

export const topicsRelations = relations(topics, ({ one, many }) => ({
  parent: one(topics, { fields: [topics.parentId], references: [topics.id], relationName: 'topicTree' }),
  children: many(topics, { relationName: 'topicTree' }),
  subject: one(subjects, { fields: [topics.subjectId], references: [subjects.id] }),
}))

export const learningGroupsRelations = relations(learningGroups, ({ one, many }) => ({
  subject: one(subjects, { fields: [learningGroups.subjectId], references: [subjects.id] }),
  lessons: many(lessons),
}))

export const importRunsRelations = relations(importRuns, ({ one, many }) => ({
  user: one(users, { fields: [importRuns.userId], references: [users.id] }),
  items: many(importRunItems),
  logs: many(importLogs),
}))

export const importRunItemsRelations = relations(importRunItems, ({ one }) => ({
  run: one(importRuns, { fields: [importRunItems.runId], references: [importRuns.id] }),
}))

export const importLogsRelations = relations(importLogs, ({ one }) => ({
  run: one(importRuns, { fields: [importLogs.runId], references: [importRuns.id] }),
}))

export const aiJobsRelations = relations(aiJobs, ({ one }) => ({
  user: one(users, { fields: [aiJobs.userId], references: [users.id] }),
  material: one(materials, { fields: [aiJobs.materialId], references: [materials.id] }),
  resultMaterial: one(materials, {
    fields: [aiJobs.resultMaterialId],
    references: [materials.id],
  }),
}))
