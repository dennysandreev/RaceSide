export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TableDefinition<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: never[];
};

export type Database = {
  public: {
    Tables: {
      subscription_plans: TableDefinition<{
        id: string;
        code: string;
        name: string;
        entitlements: string[];
        active: boolean;
        created_at: string;
        updated_at: string;
      }>;
      subscription_prices: TableDefinition<{
        id: string;
        plan_id: string;
        code: string;
        amount_minor: number;
        currency: string;
        duration_months: number;
        first_purchase_only: boolean;
        active: boolean;
        valid_from: string;
        valid_until: string | null;
        created_at: string;
        updated_at: string;
      }>;
      billing_orders: TableDefinition<{
        id: string;
        order_number: string;
        user_id: string;
        plan_id: string;
        price_id: string;
        provider: "tribute" | "yoomoney" | "lava";
        payment_method: "tribute" | "yoomoney_card" | "yoomoney_wallet" | "lava" | "lava_rub";
        amount_minor: number;
        currency: string;
        duration_months: number;
        plan_name_snapshot: string;
        price_name_snapshot: string;
        provider_label: string | null;
        provider_order_id: string | null;
        buyer_email: string | null;
        lava_parent_contract_id: string | null;
        lava_auto_renew: boolean;
        lava_cancelled_at: string | null;
        refunded_amount_minor: number;
        payment_dispute_status: string | null;
        checkout_url: string | null;
        idempotency_key: string;
        status: "pending" | "paid" | "failed" | "refunded" | "partially_refunded";
        failure_reason: string | null;
        expires_at: string;
        paid_at: string | null;
        failed_at: string | null;
        refunded_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      payment_transactions: TableDefinition<{
        id: string;
        order_id: string;
        provider: "tribute" | "yoomoney" | "lava";
        provider_transaction_id: string;
        payment_method: string;
        gross_amount_minor: number;
        net_amount_minor: number;
        provider_fee_minor: number;
        currency: string;
        occurred_at: string;
        created_at: string;
      }>;
      subscriptions: TableDefinition<{
        id: string;
        user_id: string;
        plan_id: string;
        status: "active" | "expired" | "revoked";
        current_period_start: string | null;
        current_period_end: string | null;
        last_paid_order_id: string | null;
        created_at: string;
        updated_at: string;
      }>;
      subscription_periods: TableDefinition<{
        id: string;
        subscription_id: string;
        order_id: string | null;
        starts_at: string;
        ends_at: string;
        status: "active" | "revoked" | "refunded";
        source: "payment" | "admin_grant" | "admin_adjustment" | "refund";
        created_by_admin_id: string | null;
        admin_reason: string | null;
        idempotency_key: string | null;
        created_at: string;
        updated_at: string;
      }>;
      billing_notification_events: TableDefinition<{
        id: string;
        provider: "tribute" | "yoomoney" | "lava";
        provider_event_id: string;
        provider_event_type: string;
        provider_reference: string | null;
        signature_valid: boolean;
        status: "received" | "processed" | "rejected" | "failed";
        payload_hash: string;
        safe_payload: Json;
        attempts: number;
        last_error: string | null;
        received_at: string;
        processed_at: string | null;
      }>;
      billing_email_deliveries: TableDefinition<{
        id: string;
        order_id: string;
        template: string;
        recipient_email: string | null;
        status: "queued" | "sending" | "sent" | "failed" | "skipped";
        attempts: number;
        provider_message_id: string | null;
        last_error: string | null;
        available_at: string;
        sent_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      billing_rate_limits: TableDefinition<{
        scope: string;
        identity_hash: string;
        window_started_at: string;
        request_count: number;
        updated_at: string;
      }>;
      profiles: TableDefinition<{
        id: string;
        email: string | null;
        display_name: string | null;
        language: string;
        timezone: string;
        onboarding_completed: boolean;
        is_bot: boolean;
        created_at: string;
        updated_at: string;
      }>;
      telegram_accounts: TableDefinition<{
        user_id: string;
        telegram_user_id: number;
        chat_id: number;
        username: string | null;
        first_name: string | null;
        is_active: boolean;
        connected_at: string;
        disconnected_at: string | null;
        last_delivery_at: string | null;
        last_error: string | null;
        updated_at: string;
      }>;
      telegram_link_tokens: TableDefinition<{
        id: string;
        user_id: string;
        token_hash: string;
        expires_at: string;
        used_at: string | null;
        created_at: string;
      }>;
      notification_preferences: TableDefinition<{
        user_id: string;
        telegram_enabled: boolean;
        practice_reminders: boolean;
        qualifying_reminders: boolean;
        sprint_reminders: boolean;
        race_reminders: boolean;
        reminder_24h: boolean;
        reminder_1h: boolean;
        reminder_15m: boolean;
        schedule_changes: boolean;
        practice_results: boolean;
        qualifying_results: boolean;
        sprint_results: boolean;
        race_results: boolean;
        fantasy_opened: boolean;
        fantasy_incomplete: boolean;
        fantasy_deadlines: boolean;
        fantasy_reminder_4h: boolean;
        fantasy_reminder_15m: boolean;
        fantasy_locked: boolean;
        fantasy_scored: boolean;
        fantasy_rank_changes: boolean;
        important_news: boolean;
        favorite_driver_news: boolean;
        favorite_team_news: boolean;
        transfer_news: boolean;
        steward_news: boolean;
        technical_news: boolean;
        daily_digest: boolean;
        weather_changes: boolean;
        rain_alerts: boolean;
        extreme_heat_alerts: boolean;
        possible_session_delay: boolean;
        championship_updates: boolean;
        session_notifications: Json;
        quiet_hours_start: string | null;
        quiet_hours_end: string | null;
        delivery_mode: string;
        updated_at: string;
      }>;
      spoiler_reveals: TableDefinition<{
        user_id: string;
        session_id: string;
        revealed_at: string;
      }>;
      notification_queue: TableDefinition<{
        id: string;
        user_id: string;
        event_type: string;
        entity_type: string | null;
        entity_id: string | null;
        payload: Json;
        available_at: string;
        status: string;
        dedupe_key: string;
        attempts: number;
        last_error: string | null;
        created_at: string;
        sent_at: string | null;
      }>;
      notification_logs: TableDefinition<{
        id: string;
        queue_id: string | null;
        user_id: string;
        channel: string;
        event_type: string;
        status: string;
        provider_message_id: string | null;
        error_message: string | null;
        created_at: string;
      }>;
      admin_users: TableDefinition<{
        user_id: string;
        created_at: string;
      }>;
      admin_audit_log: TableDefinition<{
        id: string;
        actor_user_id: string;
        action: string;
        entity_type: string;
        entity_id: string | null;
        outcome: "started" | "succeeded" | "failed";
        before_data: Json;
        after_data: Json;
        metadata: Json;
        error_code: string | null;
        created_at: string;
        finished_at: string | null;
      }>;
      admin_ai_budgets: TableDefinition<{
        scope: "default" | "social_x";
        daily_limit_usd: number;
        monthly_limit_usd: number;
        updated_by: string | null;
        updated_at: string;
      }>;
      admin_external_api_costs: TableDefinition<{
        provider: "x";
        resource_type: "post_read";
        unit_cost_usd: number;
        daily_limit_usd: number;
        monthly_limit_usd: number;
        updated_by: string | null;
        updated_at: string;
      }>;
      external_api_usage_events: TableDefinition<{
        id: string;
        provider: "x";
        resource_type: "post_read";
        resource_id: string;
        billing_date: string;
        unit_cost_usd: number;
        estimated_cost_usd: number;
        source_id: string | null;
        metadata: Json;
        created_at: string;
      }>;
      user_error_reports: TableDefinition<{
        id: string;
        report_kind: "news_error" | "feedback";
        contact: string | null;
        article_id: string | null;
        reporter_user_id: string | null;
        message: string;
        status: "new" | "in_progress" | "resolved" | "dismissed";
        page_path: string;
        article_slug: string | null;
        article_title: string | null;
        source_name: string | null;
        referrer_path: string | null;
        user_agent: string | null;
        release_sha: string | null;
        request_fingerprint: string | null;
        technical_context: Json;
        telegram_status: string;
        telegram_error: string | null;
        telegram_sent_at: string | null;
        telegram_attempts: number;
        telegram_last_attempt_at: string | null;
        telegram_retry_at: string;
        admin_note: string | null;
        resolved_by: string | null;
        resolved_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      ai_prompt_versions: TableDefinition<{
        id: string;
        prompt_key: string;
        version: number;
        status: "draft" | "published" | "archived";
        system_prompt: string;
        user_template: string;
        model: string | null;
        max_tokens: number | null;
        change_note: string | null;
        checksum: string;
        created_by: string;
        published_by: string | null;
        created_at: string;
        published_at: string | null;
      }>;
      admin_job_schedules: TableDefinition<{
        id: string;
        schedule_key: string;
        job_name: string;
        schedule_kind: "interval" | "daily" | "adaptive";
        interval_minutes: number | null;
        daily_time_utc: string | null;
        args: Json;
        max_attempts: number;
        is_enabled: boolean;
        next_run_at: string;
        last_enqueued_at: string | null;
        last_job_run_id: string | null;
        updated_by: string | null;
        created_at: string;
        updated_at: string;
      }>;
      ops_service_heartbeats: TableDefinition<{
        service_name: "web" | "worker" | "cron" | "admin-job-runner" | "watcher" | "live";
        instance_id: string;
        release_sha: string | null;
        status: "healthy" | "degraded" | "unhealthy";
        summary: Json;
        checked_at: string;
        updated_at: string;
      }>;
      telemetry_cache: TableDefinition<{
        key: string;
        payload: Json;
        expires_at: string | null;
        updated_at: string;
      }>;
      telemetry_tasks: TableDefinition<{
        id: string;
        request_key: string;
        task: Json;
        status: "queued" | "ready" | "failed";
        result_key: string | null;
        error_code: string | null;
        job_id: string | null;
        updated_at: string;
      }>;
      admin_agent_runs: TableDefinition<{
        id: string;
        run_kind: "watcher" | "browser_smoke" | "editorial" | "bug_triage" | "weekly_audit";
        trigger_kind: "schedule" | "deploy" | "manual" | "finding";
        trigger_finding_id: string | null;
        status: "running" | "succeeded" | "partial" | "failed";
        counters: Json;
        ruleset_version: string | null;
        release_sha: string | null;
        error_code: string | null;
        error_message: string | null;
        ai_cost_usd: number;
        started_at: string;
        finished_at: string | null;
        duration_ms: number | null;
        created_at: string;
      }>;
      admin_findings: TableDefinition<{
        id: string;
        fingerprint: string;
        category: "availability" | "data" | "job" | "content" | "browser" | "security" | "cost" | "ux" | "seo";
        severity: "P0" | "P1" | "P2" | "P3";
        status: "open" | "acknowledged" | "action_pending" | "fixing" | "monitoring" | "resolved" | "ignored";
        title: string;
        description: string;
        evidence: Json;
        route: string | null;
        entity_type: string | null;
        entity_id: string | null;
        job_run_id: string | null;
        release_sha: string | null;
        owner_kind: "agent" | "human";
        owner_user_id: string | null;
        github_issue_url: string | null;
        github_pr_url: string | null;
        resolution: string | null;
        first_seen_at: string;
        last_seen_at: string;
        occurrence_count: number;
        last_alerted_at: string | null;
        alert_count: number;
        resolved_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      admin_finding_events: TableDefinition<{
        id: string;
        finding_id: string;
        event_type: "detected" | "repeated" | "severity_changed" | "action_requested" | "action_started" | "action_succeeded" | "action_failed" | "fix_pr_opened" | "acknowledged" | "resolved" | "ignored" | "reopened" | "alert_sent";
        actor_kind: "agent" | "human" | "system";
        actor_user_id: string | null;
        payload: Json;
        created_at: string;
      }>;
      admin_action_requests: TableDefinition<{
        id: string;
        finding_id: string;
        action_name: string;
        action_args: Json;
        risk_class: "R1" | "R2" | "R3" | "R4" | "R5";
        status: "proposed" | "approved" | "running" | "succeeded" | "failed" | "rejected";
        idempotency_key: string;
        requested_by_kind: "agent" | "human" | "system";
        requested_by_user_id: string | null;
        approved_by_user_id: string | null;
        job_run_id: string | null;
        result: Json;
        error_code: string | null;
        created_at: string;
        approved_at: string | null;
        started_at: string | null;
        finished_at: string | null;
        updated_at: string;
      }>;
      admin_agent_settings: TableDefinition<{
        singleton: boolean;
        is_enabled: boolean;
        mode: "shadow" | "recommend" | "limited";
        telegram_alerts_enabled: boolean;
        r2_actions_enabled: boolean;
        shadow_started_at: string;
        updated_by: string | null;
        updated_at: string;
      }>;
      teams: TableDefinition<{
        id: string;
        external_id: string | null;
        code: string;
        name: string;
        short_name: string | null;
        country: string | null;
        color_hex: string | null;
        badge_variant: string | null;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      }>;
      drivers: TableDefinition<{
        id: string;
        external_id: string | null;
        slug: string | null;
        code: string | null;
        permanent_number: number | null;
        first_name: string;
        last_name: string;
        full_name: string;
        country: string | null;
        country_code: string | null;
        current_team_id: string | null;
        avatar_style_key: string | null;
        ai_avatar_url: string | null;
        avatar_placeholder_style: string | null;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      }>;
      circuits: TableDefinition<{
        id: string;
        external_id: string | null;
        slug: string | null;
        name: string;
        country: string | null;
        locality: string | null;
        latitude: number | null;
        longitude: number | null;
        timezone: string | null;
        lap_length_km: number | null;
        race_laps: number | null;
        race_distance_km: number | null;
        turns_count: number | null;
        direction: string | null;
        first_grand_prix_year: number | null;
        lap_record_time: string | null;
        lap_record_driver: string | null;
        lap_record_year: number | null;
        drs_zones_count: number | null;
        track_type: string | null;
        track_description: string | null;
        overtaking_rating: number | null;
        qualifying_importance_rating: number | null;
        tyre_wear_rating: number | null;
        safety_car_rating: number | null;
        strategy_variability_rating: number | null;
        rain_risk_rating: number | null;
        created_at: string;
        updated_at: string;
      }>;
      circuit_grand_prix_history: TableDefinition<{
        id: string;
        circuit_id: string;
        season: number;
        round: number;
        race_id: string | null;
        race_name: string;
        race_date: string | null;
        winner_driver_id: string | null;
        winner_team_id: string | null;
        pole_driver_id: string | null;
        pole_team_id: string | null;
        winner_start_position: number | null;
        winner_from_pole: boolean | null;
        podium_json: Json;
        dnf_count: number | null;
        safety_car_count: number | null;
        vsc_count: number | null;
        red_flag_count: number | null;
        strategy_json: Json;
        raw_payload: Json;
        source_errors: Json;
        created_at: string;
        updated_at: string;
      }>;
      circuit_stats: TableDefinition<{
        id: string;
        circuit_id: string;
        calculated_from_season: number | null;
        calculated_to_season: number | null;
        races_count: number;
        pole_win_rate: number | null;
        front_row_win_rate: number | null;
        winner_avg_start_position: number | null;
        avg_position_delta: number | null;
        avg_abs_position_delta: number | null;
        best_position_gain_json: Json | null;
        worst_position_loss_json: Json | null;
        avg_dnf_count: number | null;
        avg_pit_stops: number | null;
        avg_first_pit_lap: number | null;
        most_common_strategy: string | null;
        strategy_distribution: Json;
        safety_car_frequency: number | null;
        vsc_frequency: number | null;
        red_flag_frequency: number | null;
        chaos_score: number | null;
        overtaking_level: string | null;
        qualifying_importance_level: string | null;
        strategy_variability_level: string | null;
        records_json: Json;
        ai_preview: string | null;
        ai_preview_status: string;
        ai_preview_generated_at: string | null;
        source_errors: Json;
        calculated_at: string;
        created_at: string;
        updated_at: string;
      }>;
      circuit_driver_stats: TableDefinition<{
        id: string;
        circuit_id: string;
        driver_id: string;
        season_scope: string;
        starts: number;
        wins: number;
        podiums: number;
        points_finishes: number;
        dnfs: number;
        avg_start_position: number | null;
        avg_finish_position: number | null;
        best_finish: number | null;
        best_start: number | null;
        avg_position_delta: number | null;
        total_position_delta: number;
        created_at: string;
        updated_at: string;
      }>;
      circuit_team_stats: TableDefinition<{
        id: string;
        circuit_id: string;
        team_id: string;
        season_scope: string;
        starts: number;
        wins: number;
        podiums: number;
        points_finishes: number;
        avg_points: number | null;
        best_finish: number | null;
        worst_finish: number | null;
        double_points_finishes: number;
        created_at: string;
        updated_at: string;
      }>;
      seasons: TableDefinition<{
        year: number;
        is_published: boolean;
        published_at: string | null;
        created_at: string;
      }>;
      team_lineages: TableDefinition<{
        id: string;
        slug: string;
        display_name: string;
        created_at: string;
        updated_at: string;
      }>;
      team_season_profiles: TableDefinition<{
        id: string;
        season_year: number;
        team_id: string;
        lineage_id: string;
        display_name: string;
        short_name: string | null;
        code: string | null;
        country: string | null;
        color_hex: string | null;
        logo_image_url: string | null;
        car_image_url: string | null;
        source_urls: Json;
        assets_verified_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      driver_season_profiles: TableDefinition<{
        id: string;
        season_year: number;
        driver_id: string;
        primary_team_id: string | null;
        code: string | null;
        permanent_number: number | null;
        starts: number;
        avatar_image_url: string | null;
        avatar_prompt: string | null;
        avatar_reference_url: string | null;
        avatar_review_status: string;
        source_urls: Json;
        assets_verified_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      race_track_assets: TableDefinition<{
        id: string;
        race_id: string;
        circuit_id: string | null;
        layout_slug: string;
        image_url: string | null;
        source_url: string | null;
        source_manifest: Json;
        checksum_sha256: string | null;
        is_verified: boolean;
        verified_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      news_sources: TableDefinition<{
        id: string;
        name: string;
        source_type: string;
        url: string;
        language: string | null;
        is_active: boolean;
        fetch_interval_minutes: number;
        last_fetched_at: string | null;
        last_success_at: string | null;
        last_error: string | null;
        created_at: string;
        updated_at: string;
      }>;
      news_articles: TableDefinition<{
        editorial_meta: Json;
        content_modified_at: string | null;
        id: string;
        slug: string;
        source_id: string | null;
        canonical_url: string;
        original_url: string | null;
        original_title: string;
        original_description: string | null;
        original_language: string | null;
        published_at: string | null;
        source_published_at: string | null;
        rss_guid: string | null;
        normalized_source_url: string | null;
        source_content_hash: string | null;
        fetched_at: string;
        ai_summary_ru: string | null;
        ai_summary_long_ru: string | null;
        ai_key_points_ru: string[];
        ai_highlights_ru: string[];
        ai_title_ru: string | null;
        image_url: string | null;
        source_image_url: string | null;
        image_prompt: string | null;
        image_model: string | null;
        image_status: string;
        image_generated_at: string | null;
        image_metadata: Json;
        importance_score: number;
        status: string;
        duplicate_of: string | null;
        main_fact: string | null;
        event_type: string | null;
        event_stage: string | null;
        event_date: string | null;
        event_fingerprint: string | null;
        normalized_entities: Json;
        ingested_at: string;
        dedup_checked_at: string | null;
        dedup_status: string;
        publication_status: string;
        duplicate_confidence: number | null;
        duplicate_relation: string | null;
        duplicate_reason: string | null;
        dedup_candidate_count: number;
        dedup_processing_time_ms: number | null;
        dedup_decision_history: Json;
        published_manually: boolean;
        manual_published_at: string | null;
        manual_published_by: string | null;
        related_race_id: string | null;
        raw_payload: Json | null;
        ai_model: string | null;
        ai_processed_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      news_dedup_locks: TableDefinition<{
        lock_key: string;
        article_id: string;
        acquired_at: string;
        expires_at: string;
      }>;
      news_editorial_reviews: TableDefinition<{
        id: string;
        article_id: string;
        decision: string;
        source_hash: string;
        source_snapshot: Json;
        context_snapshot: Json;
        extraction: Json | null;
        attempts: Json;
        issues: Json;
        models: Json;
        created_at: string;
      }>;
      news_article_sources: TableDefinition<{
        article_id: string;
        source_article_id: string;
        source_url: string;
        source_name: string;
        source_authors: Json;
        source_published_at: string | null;
        added_at: string;
      }>;
      news_dedup_decisions: TableDefinition<{
        id: number;
        article_id: string;
        duplicate_of: string | null;
        candidate_count: number;
        is_duplicate: boolean;
        confidence: number | null;
        relation: string | null;
        reason: string | null;
        dedup_status: string;
        publication_status: string;
        processing_time_ms: number | null;
        error_message: string | null;
        decision_source: string;
        created_at: string;
      }>;
      share_links: TableDefinition<{
        code: string;
        news_article_id: string | null;
        prediction_id: string | null;
        prediction_scope: string | null;
        share_image_version: number | null;
        created_at: string;
      }>;
      user_consents: TableDefinition<{
        id: string;
        user_id: string;
        consent_type: string;
        document_version: string;
        granted: boolean;
        source: string;
        created_at: string;
        updated_at: string;
      }>;
      tags: TableDefinition<{
        id: string;
        type: string;
        slug: string;
        name: string;
        created_at: string;
      }>;
      news_article_tags: TableDefinition<{
        article_id: string;
        tag_id: string;
        confidence: number;
        method: string;
      }>;
      social_sources: TableDefinition<{
        id: string;
        platform: string;
        name: string;
        source_type: string;
        url: string;
        adapter: string;
        feed_kind: string | null;
        is_active: boolean;
        fetch_interval_minutes: number;
        last_fetched_at: string | null;
        last_success_at: string | null;
        last_error: string | null;
        external_key: string | null;
        trust_level: string;
        publication_mode: string;
        initial_backfill_days: number;
        cursor: string | null;
        last_seen_external_id: string | null;
        include_reposts: boolean;
        include_replies: boolean;
        next_fetch_at: string | null;
        rate_limited_until: string | null;
        metadata: Json;
        created_at: string;
        updated_at: string;
      }>;
      social_posts: TableDefinition<{
        id: string;
        platform: string;
        source_id: string | null;
        external_id: string;
        author: string | null;
        title: string | null;
        body: string | null;
        original_url: string;
        image_url: string | null;
        published_at: string | null;
        reaction_count: number | null;
        popularity_score: number;
        raw_payload: Json | null;
        status: string;
        original_language: string | null;
        ai_title_ru: string | null;
        ai_summary_ru: string | null;
        content_kind: string | null;
        importance_score: number;
        relevance_score: number | null;
        ai_confidence: number | null;
        ai_model: string | null;
        ai_processed_at: string | null;
        processing_attempts: number;
        next_retry_at: string | null;
        last_processing_error: string | null;
        duplicate_of: string | null;
        content_hash: string | null;
        source_metrics: Json;
        comments_count: number | null;
        repost_count: number | null;
        view_count: number | null;
        edited_at: string | null;
        last_synced_at: string;
        created_at: string;
        updated_at: string;
      }>;
      social_post_tags: TableDefinition<{
        post_id: string;
        tag_id: string;
        confidence: number;
        method: string;
        is_primary: boolean;
        created_at: string;
      }>;
      social_post_media: TableDefinition<{
        id: string;
        post_id: string;
        media_type: string;
        url: string;
        preview_url: string | null;
        alt_text: string | null;
        width: number | null;
        height: number | null;
        sort_order: number;
        provider_media_id: string | null;
        created_at: string;
      }>;
      grand_prix_reports: TableDefinition<{
        id: string;
        season: number;
        round: number;
        race_slug: string;
        race_name: string;
        circuit_name: string | null;
        country: string | null;
        race_date: string | null;
        status: string;
        is_hidden: boolean;
        source_updated_at: string | null;
        generated_at: string | null;
        summary_status: string;
        ai_summary: string | null;
        weather: Json;
        race_statistics: Json;
        results: Json;
        key_events: Json;
        pit_stops: Json;
        strategies: Json;
        teammate_comparisons: Json;
        highlights: Json;
        championship_impact: Json;
        news_summary: Json;
        source_errors: Json;
        last_error: string | null;
        refresh_stage: number;
        next_refresh_at: string | null;
        structured_hash: string | null;
        created_at: string;
        updated_at: string;
      }>;
      article_reactions: TableDefinition<{
        article_id: string;
        user_id: string;
        reaction: string;
        created_at: string;
      }>;
      user_favorite_teams: TableDefinition<{
        user_id: string;
        team_id: string;
        created_at: string;
      }>;
      user_favorite_drivers: TableDefinition<{
        user_id: string;
        driver_id: string;
        created_at: string;
      }>;
      races: TableDefinition<{
        id: string;
        season_year: number;
        round: number;
        race_name: string;
        circuit_id: string | null;
        official_url: string | null;
        race_start_at: string | null;
        status: string;
        tyre_hard_compound: string | null;
        tyre_medium_compound: string | null;
        tyre_soft_compound: string | null;
        tyre_allocation_source_url: string | null;
        tyre_allocation_updated_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      sessions: TableDefinition<{
        id: string;
        race_id: string;
        session_type: string;
        name: string;
        start_at: string | null;
        end_at: string | null;
        status: string;
        openf1_session_key: number | null;
        created_at: string;
        updated_at: string;
      }>;
      driver_standings: TableDefinition<{
        id: string;
        season_year: number;
        round: number | null;
        driver_id: string;
        team_id: string | null;
        position: number | null;
        points: number;
        wins: number;
        raw_payload: Json | null;
        updated_at: string;
      }>;
      constructor_standings: TableDefinition<{
        id: string;
        season_year: number;
        round: number | null;
        team_id: string;
        position: number | null;
        points: number;
        wins: number;
        raw_payload: Json | null;
        updated_at: string;
      }>;
      session_results: TableDefinition<{
        id: string;
        session_id: string;
        driver_id: string | null;
        team_id: string | null;
        position: number | null;
        classified_position: string | null;
        grid: number | null;
        laps: number | null;
        points: number | null;
        status: string | null;
        time_text: string | null;
        raw_payload: Json | null;
        created_at: string;
        updated_at: string;
      }>;
      race_starting_grid: TableDefinition<{
        race_id: string;
        driver_id: string;
        team_id: string | null;
        position: number;
        lap_time_text: string | null;
        source: string;
        source_session_key: number | null;
        raw_payload: Json | null;
        created_at: string;
        updated_at: string;
      }>;
      circuit_weather: TableDefinition<{
        id: string;
        race_id: string | null;
        circuit_id: string | null;
        temperature_c: number | null;
        wind_speed_kmh: number | null;
        precipitation_mm: number | null;
        weather_code: number | null;
        observed_at: string | null;
        provider: string;
        raw_payload: Json | null;
        created_at: string;
        updated_at: string;
      }>;
      circuit_layouts: TableDefinition<{
        id: string;
        circuit_id: string;
        provider: string;
        svg_path: string;
        view_box: string;
        source_session_key: number | null;
        raw_payload: Json | null;
        created_at: string;
        updated_at: string;
      }>;
      track_maps: TableDefinition<{
        id: string;
        circuit_id: string | null;
        circuit_key: string;
        circuit_name: string;
        season_source: number;
        meeting_key: number | null;
        session_key: number | null;
        definition: Json;
        created_at: string;
        updated_at: string;
      }>;
      race_replay_sessions: TableDefinition<{
        id: string;
        race_id: string | null;
        circuit_id: string | null;
        track_map_id: string | null;
        title: string;
        status: string;
        source_season: number;
        source_meeting_key: number | null;
        source_session_key: number;
        source_session_name: string | null;
        source_race_name: string | null;
        source_started_at: string | null;
        duration_ms: number | null;
        total_laps: number | null;
        snapshot: Json;
        source_errors: Json;
        prepared_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      race_replay_events: TableDefinition<{
        id: string;
        replay_session_id: string;
        event_time: string;
        offset_ms: number;
        event_type: string;
        driver_number: number | null;
        payload: Json;
        created_at: string;
      }>;
      session_weather: TableDefinition<{
        id: string;
        session_id: string;
        race_id: string | null;
        circuit_id: string | null;
        temperature_c: number | null;
        wind_speed_kmh: number | null;
        precipitation_mm: number | null;
        weather_code: number | null;
        forecast_at: string | null;
        provider: string;
        raw_payload: Json | null;
        created_at: string;
        updated_at: string;
      }>;
      prediction_leagues: TableDefinition<{
        avatar_path: string | null;
        avatar_updated_at: string | null;
        id: string;
        owner_user_id: string;
        name: string;
        invite_code: string;
        is_public: boolean;
        created_at: string;
        updated_at: string;
      }>;
      prediction_league_members: TableDefinition<{
        league_id: string;
        user_id: string;
        role: string;
        joined_at: string;
      }>;
      predictions: TableDefinition<{
        id: string;
        user_id: string;
        race_id: string;
        league_id: string | null;
        pole_driver_id: string | null;
        winner_driver_id: string | null;
        fastest_lap_driver_id: string | null;
        dnf_driver_id: string | null;
        dnf_pick_kind: string;
        top_scoring_team_id: string | null;
        fastest_pit_stop_team_id: string | null;
        top3_driver_ids: string[] | null;
        top10_driver_ids: string[] | null;
        submitted_at: string;
        locked_at: string | null;
        score: number | null;
        score_breakdown: Json | null;
        scored_at: string | null;
        is_public: boolean;
        share_slug: string | null;
        shared_at: string | null;
        share_image_version: number;
      }>;
      polls: TableDefinition<{
        id: string;
        race_id: string | null;
        question: string;
        status: string;
        closes_at: string | null;
        poll_kind: string | null;
        generated_by_ai: boolean;
        generated_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      poll_options: TableDefinition<{
        id: string;
        poll_id: string;
        label: string;
        sort_order: number;
      }>;
      poll_votes: TableDefinition<{
        poll_id: string;
        option_id: string;
        user_id: string;
        created_at: string;
      }>;
      digests: TableDefinition<{
        id: string;
        digest_type: string;
        date_key: string | null;
        race_id: string | null;
        title: string;
        body_md: string;
        ai_model: string | null;
        generated_at: string;
        status: string;
      }>;
      job_runs: TableDefinition<{
        id: string;
        job_name: string;
        status: string;
        started_at: string;
        finished_at: string | null;
        items_processed: number;
        error_message: string | null;
        metadata: Json | null;
        queue_version: number | null;
        requested_by: string | null;
        available_at: string | null;
        claimed_at: string | null;
        lease_expires_at: string | null;
        worker_id: string | null;
        attempt_count: number;
        max_attempts: number;
        retry_of: string | null;
        request_key: string | null;
      }>;
      ai_usage_logs: TableDefinition<{
        id: string;
        purpose: string;
        provider: string;
        model: string;
        input_tokens: number | null;
        output_tokens: number | null;
        estimated_cost_usd: number | null;
        related_article_id: string | null;
        related_digest_id: string | null;
        prompt_key: string | null;
        prompt_version_id: string | null;
        created_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      get_admin_operations_snapshot: { Args: Record<string, never>; Returns: Json };
      get_admin_sport_season_counts: { Args: { p_season: number }; Returns: Json };
      get_admin_billing_page: { Args: { p_search_pattern: string; p_status?: string | null; p_provider?: string | null; p_currency?: string | null; p_since?: string | null; p_until?: string | null; p_page: number; p_page_size: number }; Returns: Json };
      get_admin_ai_prompt_history: { Args: { p_prompt_key: string; p_page: number; p_page_size: number }; Returns: Json };
      get_admin_ai_prompt_history_overview: { Args: Record<string, never>; Returns: Database["public"]["Tables"]["ai_prompt_versions"]["Row"][] };
      get_admin_ai_latest_drafts: { Args: Record<string, never>; Returns: Database["public"]["Tables"]["ai_prompt_versions"]["Row"][] };
      admin_retry_telemetry_task: { Args: { p_task_id: string; p_previous_job_id: string; p_actor_user_id: string }; Returns: string };
      admin_retry_failed_social_posts: { Args: { p_limit: number }; Returns: number };
      get_admin_poll_vote_counts: { Args: { p_poll_ids: string[] }; Returns: Array<{ poll_id: string; vote_count: number }> };
      get_admin_user_engagement_counts: { Args: { p_user_ids: string[] }; Returns: Array<{ user_id: string; favorite_teams: number; favorite_drivers: number; predictions: number; leagues: number }> };
      billing_apply_payment: {
        Args: {
          p_order_id: string;
          p_provider: string;
          p_provider_event_id: string;
          p_provider_event_type: string;
          p_provider_reference: string;
          p_provider_transaction_id: string;
          p_payment_method: string;
          p_gross_amount_minor: number;
          p_net_amount_minor: number;
          p_currency: string;
          p_occurred_at: string;
          p_payload_hash: string;
          p_safe_payload?: Json;
        };
        Returns: Array<{
          applied: boolean;
          subscription_id: string;
          period_id: string;
          period_end: string;
        }>;
      };
      billing_admin_grant: {
        Args: {
          p_target_user_id: string;
          p_actor_user_id: string;
          p_duration_kind: string;
          p_custom_end: string | null;
          p_reason: string;
          p_idempotency_key: string;
          p_now?: string;
        };
        Returns: Array<{
          period_id: string;
          starts_at: string;
          ends_at: string;
        }>;
      };
      billing_apply_refund: {
        Args: {
          p_order_id: string;
          p_amount_minor: number;
          p_provider: string;
          p_provider_event_id: string;
          p_provider_event_type: string;
          p_payload_hash: string;
        };
        Returns: boolean;
      };
      billing_apply_lava_adjustment: {
        Args: {
          p_order_id: string;
          p_event_id: string;
          p_event_type: string;
          p_amount_minor: number;
          p_currency: string;
          p_payload_hash: string;
          p_safe_payload?: Json;
        };
        Returns: boolean;
      };
      billing_apply_lava_renewal: {
        Args: {
          p_parent_contract_id: string;
          p_invoice_id: string;
          p_amount_minor: number;
          p_fee_minor: number;
          p_currency: string;
          p_occurred_at: string;
          p_payload_hash: string;
        };
        Returns: string;
      };
      billing_mark_lava_cancelled: {
        Args: {
          p_invoice_id: string;
          p_email: string;
          p_event_id: string;
          p_occurred_at: string;
          p_payload_hash: string;
        };
        Returns: string;
      };
      billing_consume_rate_limit: {
        Args: {
          p_scope: string;
          p_identity_hash: string;
          p_limit: number;
          p_window_seconds: number;
          p_now?: string;
        };
        Returns: Array<{
          allowed: boolean;
          remaining: number;
          reset_at: string;
        }>;
      };
      billing_admin_revoke: {
        Args: {
          p_target_user_id: string;
          p_actor_user_id: string;
          p_reason: string;
          p_now?: string;
        };
        Returns: Array<{
          revoked: boolean;
          previous_period_end: string | null;
        }>;
      };
      admin_save_news_article: {
        Args: {
          p_actor_user_id: string;
          p_article_id: string;
          p_body: string | null;
          p_now: string;
          p_publication_status: string;
          p_summary: string | null;
          p_tag_names: string[];
          p_title: string | null;
        };
        Returns: undefined;
      };
      admin_save_news_article_editorial: {
        Args: {
          p_actor_user_id: string;
          p_article_id: string;
          p_body: string | null;
          p_now: string;
          p_publication_status: string;
          p_summary: string | null;
          p_tag_names: string[];
          p_title: string | null;
          p_article_type: string;
          p_source_authors: string[];
        };
        Returns: undefined;
      };
      admin_moderate_social_post: {
        Args: {
          p_action: string;
          p_actor_user_id: string;
          p_now: string;
          p_post_id: string;
          p_request_key: string;
          p_topic_name: string | null;
          p_topic_slug: string | null;
        };
        Returns: string | null;
      };
      admin_save_poll: {
        Args: {
          p_closes_at: string | null;
          p_options: string[];
          p_poll_id: string | null;
          p_question: string;
          p_status: string;
        };
        Returns: string;
      };
      is_admin: {
        Args: never;
        Returns: boolean;
      };
      claim_next_admin_job: {
        Args: {
          p_worker_id: string;
        };
        Returns: Database["public"]["Tables"]["job_runs"]["Row"][];
      };
      renew_admin_job_lease: {
        Args: {
          p_job_id: string;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      record_admin_finding: {
        Args: {
          p_fingerprint: string;
          p_category: string;
          p_severity: string;
          p_title: string;
          p_description: string;
          p_evidence?: Json;
          p_route?: string | null;
          p_entity_type?: string | null;
          p_entity_id?: string | null;
          p_job_run_id?: string | null;
          p_release_sha?: string | null;
        };
        Returns: {
          finding_id: string;
          was_created: boolean;
          current_status: string;
          current_occurrence_count: number;
        }[];
      };
      transition_admin_finding: {
        Args: {
          p_finding_id: string;
          p_status: string;
          p_actor_kind?: string;
          p_actor_user_id?: string | null;
          p_resolution?: string | null;
        };
        Returns: Database["public"]["Tables"]["admin_findings"]["Row"];
      };
      mark_admin_finding_alerted: {
        Args: {
          p_finding_id: string;
        };
        Returns: undefined;
      };
      get_admin_ai_usage_summary: {
        Args: {
          p_since: string;
        };
        Returns: Array<{
          dimension: "day" | "model" | "purpose" | "total";
          bucket: string;
          request_count: number;
          input_tokens: number;
          output_tokens: number;
          cost_usd: number;
          unpriced_count: number;
        }>;
      };
      get_admin_cost_timeline: {
        Args: {
          p_since: string;
        };
        Returns: Array<{
          day: string;
          ai_cost_usd: number;
          x_api_cost_usd: number;
          x_post_count: number;
        }>;
      };
      save_admin_ai_prompt_version: {
        Args: {
          p_prompt_key: string;
          p_system_prompt: string;
          p_user_template: string;
          p_model: string;
          p_max_tokens: number;
          p_change_note: string;
          p_actor: string;
          p_publish: boolean;
          p_checksum: string;
        };
        Returns: Array<{
          saved_id: string;
          saved_version: number;
          saved_status: "draft" | "published";
        }>;
      };
      get_ai_budget_guard: {
        Args: {
          p_purpose: string;
        };
        Returns: Array<{
          scope: "default";
          daily_limit_usd: number;
          monthly_limit_usd: number;
          daily_spend_usd: number;
          monthly_spend_usd: number;
          allowed: boolean;
        }>;
      };
      get_x_api_budget_guard: {
        Args: never;
        Returns: Array<{
          unit_cost_usd: number;
          daily_limit_usd: number;
          monthly_limit_usd: number;
          daily_spend_usd: number;
          monthly_spend_usd: number;
          daily_post_count: number;
          monthly_post_count: number;
          allowed: boolean;
        }>;
      };
      submit_site_feedback: {
        Args: {
          p_message: string;
          p_contact: string | null;
          p_request_fingerprint: string;
          p_user_id: string | null;
        };
        Returns: string;
      };
      claim_site_feedback_delivery: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["user_error_reports"]["Row"][];
      };
      submit_news_error_report: {
        Args: {
          p_article_id: string;
          p_message: string;
          p_page_path: string;
          p_referrer_path?: string | null;
          p_user_agent?: string | null;
          p_release_sha?: string | null;
          p_request_fingerprint?: string | null;
          p_technical_context?: Json;
        };
        Returns: string;
      };
      finish_news_error_report_delivery: {
        Args: {
          p_report_id: string;
          p_status: "sent" | "failed" | "not_configured";
          p_error?: string | null;
        };
        Returns: boolean;
      };
      enqueue_due_admin_schedules: {
        Args: {
          p_limit?: number;
        };
        Returns: number;
      };
      acquire_news_dedup_lock: {
        Args: {
          p_lock_key: string;
          p_article_id: string;
          p_stale_after_seconds?: number;
        };
        Returns: boolean;
      };
      release_news_dedup_lock: {
        Args: {
          p_lock_key: string;
          p_article_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
