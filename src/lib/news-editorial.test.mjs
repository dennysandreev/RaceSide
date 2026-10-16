import assert from "node:assert/strict";
import test from "node:test";
import { formatNewsDate, formatNewsContext, newsArticleTypeLabel, newsReviewIssueLabel } from "./news-editorial.ts";

test("reader sees opinion attribution and exact Moscow publication time", () => {
  assert.equal(newsArticleTypeLabel("opinion"), "Мнение");
  assert.match(formatNewsDate("2026-09-22T09:45:00Z"), /12:45/);
  assert.equal(formatNewsDate("invalid"), null);
});

test("standings context identifies season and round, without presenting a race result as standings", () => {
  const fact = { kind: "championship_position", subject: "Lewis Hamilton", value: 4, scope: "season_2026_after_round_14" };
  assert.match(formatNewsContext(fact), /2026, после 14-го этапа/);
  assert.equal(formatNewsContext({ ...fact, kind: "session_position", scope: "2026:Monza:race" }), null);
  assert.match(newsReviewIssueLabel("driver_team_conflict"), /Команда пилота/);
  assert.equal(newsReviewIssueLabel("internal_unknown_error"), "Требуется сверка с оригиналом.");
});

test("historical technical holds do not claim that the source lacks a fact", () => {
  assert.doesNotMatch(newsReviewIssueLabel("invented_number:250"), /не найдено/);
  assert.match(newsReviewIssueLabel("invented_number:250"), /единицы/);
  assert.match(newsReviewIssueLabel("unknown_source_fact"), /служебных данных/);
});
