export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      approvals: {
        Row: {
          amount: number | null
          approver_profile_id: string | null
          approver_user_id: string | null
          created_at: string
          currency: string | null
          decided_at: string | null
          decision_note: string | null
          due_at: string | null
          id: string
          kind: Database["public"]["Enums"]["approval_kind"]
          link_path: string | null
          requested_by: string | null
          source_id: string
          source_table: string
          status: Database["public"]["Enums"]["approval_status"]
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          approver_profile_id?: string | null
          approver_user_id?: string | null
          created_at?: string
          currency?: string | null
          decided_at?: string | null
          decision_note?: string | null
          due_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["approval_kind"]
          link_path?: string | null
          requested_by?: string | null
          source_id: string
          source_table: string
          status?: Database["public"]["Enums"]["approval_status"]
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          approver_profile_id?: string | null
          approver_user_id?: string | null
          created_at?: string
          currency?: string | null
          decided_at?: string | null
          decision_note?: string | null
          due_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["approval_kind"]
          link_path?: string | null
          requested_by?: string | null
          source_id?: string
          source_table?: string
          status?: Database["public"]["Enums"]["approval_status"]
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      azure_devops_tokens: {
        Row: {
          access_token: string
          connected_by: string
          created_at: string
          id: string
          org_url: string | null
          refresh_token: string
          token_expiry: string
          updated_at: string
        }
        Insert: {
          access_token: string
          connected_by: string
          created_at?: string
          id?: string
          org_url?: string | null
          refresh_token: string
          token_expiry: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          connected_by?: string
          created_at?: string
          id?: string
          org_url?: string | null
          refresh_token?: string
          token_expiry?: string
          updated_at?: string
        }
        Relationships: []
      }
      azure_work_items: {
        Row: {
          area_path: string | null
          assigned_to: string | null
          changed_date: string | null
          created_at: string
          created_date: string | null
          description: string | null
          external_id: number
          id: string
          iteration_path: string | null
          priority: number | null
          project_name: string | null
          raw_data: Json | null
          release: string | null
          state: string | null
          synced_at: string
          tags: string | null
          title: string
          updated_at: string
          work_item_type: string | null
        }
        Insert: {
          area_path?: string | null
          assigned_to?: string | null
          changed_date?: string | null
          created_at?: string
          created_date?: string | null
          description?: string | null
          external_id: number
          id?: string
          iteration_path?: string | null
          priority?: number | null
          project_name?: string | null
          raw_data?: Json | null
          release?: string | null
          state?: string | null
          synced_at?: string
          tags?: string | null
          title: string
          updated_at?: string
          work_item_type?: string | null
        }
        Update: {
          area_path?: string | null
          assigned_to?: string | null
          changed_date?: string | null
          created_at?: string
          created_date?: string | null
          description?: string | null
          external_id?: number
          id?: string
          iteration_path?: string | null
          priority?: number | null
          project_name?: string | null
          raw_data?: Json | null
          release?: string | null
          state?: string | null
          synced_at?: string
          tags?: string | null
          title?: string
          updated_at?: string
          work_item_type?: string | null
        }
        Relationships: []
      }
      basecamp_tokens: {
        Row: {
          access_token: string
          account_id: string | null
          connected_by: string
          created_at: string
          id: string
          refresh_token: string
          token_expiry: string
          updated_at: string
        }
        Insert: {
          access_token: string
          account_id?: string | null
          connected_by: string
          created_at?: string
          id?: string
          refresh_token: string
          token_expiry: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          account_id?: string | null
          connected_by?: string
          created_at?: string
          id?: string
          refresh_token?: string
          token_expiry?: string
          updated_at?: string
        }
        Relationships: []
      }
      budgets: {
        Row: {
          allocated_amount: number
          category: Database["public"]["Enums"]["po_category"]
          created_at: string
          department_id: string
          fiscal_year: number
          id: string
          spent_amount: number
          updated_at: string
        }
        Insert: {
          allocated_amount?: number
          category: Database["public"]["Enums"]["po_category"]
          created_at?: string
          department_id: string
          fiscal_year?: number
          id?: string
          spent_amount?: number
          updated_at?: string
        }
        Update: {
          allocated_amount?: number
          category?: Database["public"]["Enums"]["po_category"]
          created_at?: string
          department_id?: string
          fiscal_year?: number
          id?: string
          spent_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_mutation_audit: {
        Row: {
          actor_user_id: string | null
          after_state: Json | null
          before_state: Json | null
          calendar_id: string | null
          created_at: string
          error: string | null
          event_id: string | null
          google_event_id: string | null
          id: string
          ok: boolean
          requested: Json
          source: string
          tool_name: string
          verified: boolean
        }
        Insert: {
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          calendar_id?: string | null
          created_at?: string
          error?: string | null
          event_id?: string | null
          google_event_id?: string | null
          id?: string
          ok?: boolean
          requested?: Json
          source: string
          tool_name: string
          verified?: boolean
        }
        Update: {
          actor_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          calendar_id?: string | null
          created_at?: string
          error?: string | null
          event_id?: string | null
          google_event_id?: string | null
          id?: string
          ok?: boolean
          requested?: Json
          source?: string
          tool_name?: string
          verified?: boolean
        }
        Relationships: []
      }
      candidates: {
        Row: {
          attachment_filename: string | null
          competency_score: number | null
          created_at: string
          cv_hash: string | null
          cv_storage_path: string | null
          cv_text: string | null
          email: string | null
          email_subject: string | null
          failure_reason: string | null
          gmail_message_id: string | null
          hireflix_candidate_id: string | null
          hireflix_interview_id: string | null
          hireflix_interview_url: string | null
          hireflix_invited_at: string | null
          hireflix_playback_url: string | null
          hireflix_status: string | null
          id: string
          interview_final_score: number | null
          interview_scored_at: string | null
          interview_scores: Json | null
          interview_transcript: string | null
          is_score_locked: boolean
          job_role_id: string | null
          name: string
          scoring_details: Json | null
          status: string
          total_score: number | null
          updated_at: string
          values_score: number | null
        }
        Insert: {
          attachment_filename?: string | null
          competency_score?: number | null
          created_at?: string
          cv_hash?: string | null
          cv_storage_path?: string | null
          cv_text?: string | null
          email?: string | null
          email_subject?: string | null
          failure_reason?: string | null
          gmail_message_id?: string | null
          hireflix_candidate_id?: string | null
          hireflix_interview_id?: string | null
          hireflix_interview_url?: string | null
          hireflix_invited_at?: string | null
          hireflix_playback_url?: string | null
          hireflix_status?: string | null
          id?: string
          interview_final_score?: number | null
          interview_scored_at?: string | null
          interview_scores?: Json | null
          interview_transcript?: string | null
          is_score_locked?: boolean
          job_role_id?: string | null
          name: string
          scoring_details?: Json | null
          status?: string
          total_score?: number | null
          updated_at?: string
          values_score?: number | null
        }
        Update: {
          attachment_filename?: string | null
          competency_score?: number | null
          created_at?: string
          cv_hash?: string | null
          cv_storage_path?: string | null
          cv_text?: string | null
          email?: string | null
          email_subject?: string | null
          failure_reason?: string | null
          gmail_message_id?: string | null
          hireflix_candidate_id?: string | null
          hireflix_interview_id?: string | null
          hireflix_interview_url?: string | null
          hireflix_invited_at?: string | null
          hireflix_playback_url?: string | null
          hireflix_status?: string | null
          id?: string
          interview_final_score?: number | null
          interview_scored_at?: string | null
          interview_scores?: Json | null
          interview_transcript?: string | null
          is_score_locked?: boolean
          job_role_id?: string | null
          name?: string
          scoring_details?: Json | null
          status?: string
          total_score?: number | null
          updated_at?: string
          values_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "candidates_job_role_id_fkey"
            columns: ["job_role_id"]
            isOneToOne: false
            referencedRelation: "job_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      ceo_action_routing: {
        Row: {
          created_at: string
          display_name: string
          email: string | null
          owner_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email?: string | null
          owner_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string | null
          owner_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      ceo_briefing_email_logs: {
        Row: {
          action_count: number
          briefing_id: string
          created_at: string
          error_message: string | null
          id: string
          owner_key: string | null
          recipient_email: string
          sent_at: string | null
          sent_by: string | null
          status: string
        }
        Insert: {
          action_count?: number
          briefing_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          owner_key?: string | null
          recipient_email: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
        }
        Update: {
          action_count?: number
          briefing_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          owner_key?: string | null
          recipient_email?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ceo_briefing_email_logs_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "ceo_briefings"
            referencedColumns: ["id"]
          },
        ]
      }
      ceo_briefing_jobs: {
        Row: {
          briefing_id: string | null
          briefing_type: string
          created_at: string
          error: string | null
          id: string
          phase: string
          progress: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          briefing_id?: string | null
          briefing_type?: string
          created_at?: string
          error?: string | null
          id?: string
          phase?: string
          progress?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          briefing_id?: string | null
          briefing_type?: string
          created_at?: string
          error?: string | null
          id?: string
          phase?: string
          progress?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ceo_briefings: {
        Row: {
          briefing_date: string
          briefing_type: string
          created_at: string
          execution_score: number | null
          generated_by: string | null
          id: string
          outcome_probability: number | null
          payload: Json
          trajectory: string | null
          workstream_scores: Json
        }
        Insert: {
          briefing_date?: string
          briefing_type: string
          created_at?: string
          execution_score?: number | null
          generated_by?: string | null
          id?: string
          outcome_probability?: number | null
          payload?: Json
          trajectory?: string | null
          workstream_scores?: Json
        }
        Update: {
          briefing_date?: string
          briefing_type?: string
          created_at?: string
          execution_score?: number | null
          generated_by?: string | null
          id?: string
          outcome_probability?: number | null
          payload?: Json
          trajectory?: string | null
          workstream_scores?: Json
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          role: string
          user_id: string | null
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          role: string
          user_id?: string | null
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "project_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_write_pending: {
        Row: {
          created_at: string
          error: string | null
          executed_at: string | null
          expires_at: string
          id: string
          idempotency_key: string
          result: Json | null
          status: Database["public"]["Enums"]["chat_write_status"]
          summary: string | null
          tool_args: Json
          tool_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          executed_at?: string | null
          expires_at?: string
          id?: string
          idempotency_key: string
          result?: Json | null
          status?: Database["public"]["Enums"]["chat_write_status"]
          summary?: string | null
          tool_args?: Json
          tool_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          executed_at?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          result?: Json | null
          status?: Database["public"]["Enums"]["chat_write_status"]
          summary?: string | null
          tool_args?: Json
          tool_name?: string
          user_id?: string
        }
        Relationships: []
      }
      company_integrations: {
        Row: {
          created_at: string
          documents_ingested: number | null
          encrypted_api_key: string | null
          id: string
          integration_id: string
          last_sync: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          documents_ingested?: number | null
          encrypted_api_key?: string | null
          id?: string
          integration_id: string
          last_sync?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          documents_ingested?: number | null
          encrypted_api_key?: string | null
          id?: string
          integration_id?: string
          last_sync?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      correctness_violations: {
        Row: {
          created_at: string
          draft_preview: string | null
          id: string
          model: string | null
          read_results_seen: Json
          turn_id: string | null
          user_id: string | null
          violation_count: number
          violation_details: Json
          violation_kinds: string[]
        }
        Insert: {
          created_at?: string
          draft_preview?: string | null
          id?: string
          model?: string | null
          read_results_seen?: Json
          turn_id?: string | null
          user_id?: string | null
          violation_count?: number
          violation_details?: Json
          violation_kinds?: string[]
        }
        Update: {
          created_at?: string
          draft_preview?: string | null
          id?: string
          model?: string | null
          read_results_seen?: Json
          turn_id?: string | null
          user_id?: string | null
          violation_count?: number
          violation_details?: Json
          violation_kinds?: string[]
        }
        Relationships: []
      }
      departments: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          metadata: Json
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          metadata?: Json
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          blob_path: string
          blob_url: string
          category: string | null
          chunk_count: number
          created_at: string
          error_message: string | null
          file_name: string
          file_type: string
          id: string
          owner_id: string
          scope: string
          status: string
          subcategory: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          blob_path?: string
          blob_url?: string
          category?: string | null
          chunk_count?: number
          created_at?: string
          error_message?: string | null
          file_name: string
          file_type: string
          id?: string
          owner_id: string
          scope: string
          status?: string
          subcategory?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          blob_path?: string
          blob_url?: string
          category?: string | null
          chunk_count?: number
          created_at?: string
          error_message?: string | null
          file_name?: string
          file_type?: string
          id?: string
          owner_id?: string
          scope?: string
          status?: string
          subcategory?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      duncan_calendar_tokens: {
        Row: {
          access_token: string
          calendar_id: string | null
          calendar_name: string | null
          connected_by: string
          created_at: string
          google_account_email: string | null
          id: string
          refresh_token: string
          token_expiry: string
          updated_at: string
        }
        Insert: {
          access_token: string
          calendar_id?: string | null
          calendar_name?: string | null
          connected_by: string
          created_at?: string
          google_account_email?: string | null
          id?: string
          refresh_token: string
          token_expiry: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          calendar_id?: string | null
          calendar_name?: string | null
          connected_by?: string
          created_at?: string
          google_account_email?: string | null
          id?: string
          refresh_token?: string
          token_expiry?: string
          updated_at?: string
        }
        Relationships: []
      }
      duncan_gmail_tokens: {
        Row: {
          access_token: string
          created_at: string
          google_account_email: string
          id: string
          refresh_token: string
          scopes: string | null
          token_expiry: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          google_account_email: string
          id?: string
          refresh_token: string
          scopes?: string | null
          token_expiry: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          google_account_email?: string
          id?: string
          refresh_token?: string
          scopes?: string | null
          token_expiry?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_attendees: {
        Row: {
          city: string | null
          company: string | null
          created_at: string
          email: string | null
          event_name: string
          id: string
          name: string | null
          phone: string | null
          raw: Json
          role: string | null
          upload_batch_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          city?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          event_name?: string
          id?: string
          name?: string | null
          phone?: string | null
          raw?: Json
          role?: string | null
          upload_batch_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          city?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          event_name?: string
          id?: string
          name?: string | null
          phone?: string | null
          raw?: Json
          role?: string | null
          upload_batch_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      event_rsvp_messages: {
        Row: {
          created_at: string
          gmail_message_id: string
          gmail_thread_id: string | null
          id: string
          outcome: string | null
          processed_at: string
          rsvp_id: string | null
          sender_email: string | null
          subject: string | null
        }
        Insert: {
          created_at?: string
          gmail_message_id: string
          gmail_thread_id?: string | null
          id?: string
          outcome?: string | null
          processed_at?: string
          rsvp_id?: string | null
          sender_email?: string | null
          subject?: string | null
        }
        Update: {
          created_at?: string
          gmail_message_id?: string
          gmail_thread_id?: string | null
          id?: string
          outcome?: string | null
          processed_at?: string
          rsvp_id?: string | null
          sender_email?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvp_messages_rsvp_id_fkey"
            columns: ["rsvp_id"]
            isOneToOne: false
            referencedRelation: "event_rsvps"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvps: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          event_id: string
          first_name: string | null
          follow_up_count: number
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          last_inbound_message_id: string | null
          last_name: string | null
          notes: string | null
          organisation_name: string | null
          organisation_type: string | null
          phone: string | null
          profile_id: string | null
          reply_error: string | null
          reply_message_id: string | null
          reply_sent_at: string | null
          responded_at: string
          source: string
          state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          event_id: string
          first_name?: string | null
          follow_up_count?: number
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          last_inbound_message_id?: string | null
          last_name?: string | null
          notes?: string | null
          organisation_name?: string | null
          organisation_type?: string | null
          phone?: string | null
          profile_id?: string | null
          reply_error?: string | null
          reply_message_id?: string | null
          reply_sent_at?: string | null
          responded_at?: string
          source?: string
          state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          event_id?: string
          first_name?: string | null
          follow_up_count?: number
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          last_inbound_message_id?: string | null
          last_name?: string | null
          notes?: string | null
          organisation_name?: string | null
          organisation_type?: string | null
          phone?: string | null
          profile_id?: string | null
          reply_error?: string | null
          reply_message_id?: string | null
          reply_sent_at?: string | null
          responded_at?: string
          source?: string
          state?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "key_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_summary_runs: {
        Row: {
          blob_path: string | null
          content_hash: string | null
          created_at: string
          download_token: string | null
          email_message_id: string | null
          error: string | null
          error_details: Json | null
          failed_files: Json | null
          file_count: number | null
          file_name: string | null
          files_processed: Json | null
          finished_at: string | null
          folder_id: string | null
          folder_name: string | null
          id: string
          recipient: string | null
          run_key: string
          started_at: string
          status: string
          summary_chars: number | null
          trigger_source: string
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          blob_path?: string | null
          content_hash?: string | null
          created_at?: string
          download_token?: string | null
          email_message_id?: string | null
          error?: string | null
          error_details?: Json | null
          failed_files?: Json | null
          file_count?: number | null
          file_name?: string | null
          files_processed?: Json | null
          finished_at?: string | null
          folder_id?: string | null
          folder_name?: string | null
          id?: string
          recipient?: string | null
          run_key: string
          started_at?: string
          status?: string
          summary_chars?: number | null
          trigger_source?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          blob_path?: string | null
          content_hash?: string | null
          created_at?: string
          download_token?: string | null
          email_message_id?: string | null
          error?: string | null
          error_details?: Json | null
          failed_files?: Json | null
          file_count?: number | null
          file_name?: string | null
          files_processed?: Json | null
          finished_at?: string | null
          folder_id?: string | null
          folder_name?: string | null
          id?: string
          recipient?: string | null
          run_key?: string
          started_at?: string
          status?: string
          summary_chars?: number | null
          trigger_source?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      feature_request_attachments: {
        Row: {
          created_at: string
          feature_request_id: string
          file_name: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          feature_request_id: string
          file_name: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          feature_request_id?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_request_attachments_feature_request_id_fkey"
            columns: ["feature_request_id"]
            isOneToOne: false
            referencedRelation: "feature_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_requests: {
        Row: {
          admin_notes: string | null
          created_at: string
          description: string
          id: string
          priority: string
          status: string
          title: string
          updated_at: string
          use_case: string | null
          user_email: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          description: string
          id?: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
          use_case?: string | null
          user_email?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          description?: string
          id?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
          use_case?: string | null
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      fetch_locks: {
        Row: {
          expires_at: string
          id: string
          locked_at: string
          locked_by: string | null
          resource_key: string
        }
        Insert: {
          expires_at?: string
          id?: string
          locked_at?: string
          locked_by?: string | null
          resource_key: string
        }
        Update: {
          expires_at?: string
          id?: string
          locked_at?: string
          locked_by?: string | null
          resource_key?: string
        }
        Relationships: []
      }
      general_chat_messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "general_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      general_chats: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gmail_tokens: {
        Row: {
          access_token: string
          connected_by: string
          created_at: string
          email_address: string | null
          id: string
          refresh_token: string
          token_expiry: string
          updated_at: string
        }
        Insert: {
          access_token: string
          connected_by: string
          created_at?: string
          email_address?: string | null
          id?: string
          refresh_token: string
          token_expiry: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          connected_by?: string
          created_at?: string
          email_address?: string | null
          id?: string
          refresh_token?: string
          token_expiry?: string
          updated_at?: string
        }
        Relationships: []
      }
      gmail_writing_profiles: {
        Row: {
          auto_draft_enabled: boolean
          auto_draft_filter_list: string[]
          auto_draft_filter_mode: string
          auto_draft_last_run_at: string | null
          auto_drafts_counter_date: string
          auto_drafts_created_today: number
          ceo_briefing_optin: boolean
          common_phrases: Json
          created_at: string
          id: string
          last_trained_at: string | null
          sample_count: number
          sample_replies: Json
          style_summary: string
          tone_metrics: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_draft_enabled?: boolean
          auto_draft_filter_list?: string[]
          auto_draft_filter_mode?: string
          auto_draft_last_run_at?: string | null
          auto_drafts_counter_date?: string
          auto_drafts_created_today?: number
          ceo_briefing_optin?: boolean
          common_phrases?: Json
          created_at?: string
          id?: string
          last_trained_at?: string | null
          sample_count?: number
          sample_replies?: Json
          style_summary?: string
          tone_metrics?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_draft_enabled?: boolean
          auto_draft_filter_list?: string[]
          auto_draft_filter_mode?: string
          auto_draft_last_run_at?: string | null
          auto_drafts_counter_date?: string
          auto_drafts_created_today?: number
          ceo_briefing_optin?: boolean
          common_phrases?: Json
          created_at?: string
          id?: string
          last_trained_at?: string | null
          sample_count?: number
          sample_replies?: Json
          style_summary?: string
          tone_metrics?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_analytics_tokens: {
        Row: {
          access_token: string
          account_id: string | null
          created_at: string
          id: string
          property_id: string | null
          property_name: string | null
          refresh_token: string
          token_expiry: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          account_id?: string | null
          created_at?: string
          id?: string
          property_id?: string | null
          property_name?: string | null
          refresh_token: string
          token_expiry: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          account_id?: string | null
          created_at?: string
          id?: string
          property_id?: string | null
          property_name?: string | null
          refresh_token?: string
          token_expiry?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          created_at: string
          id: string
          refresh_token: string
          token_expiry: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          refresh_token: string
          token_expiry: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          refresh_token?: string
          token_expiry?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_drive_tokens: {
        Row: {
          access_token: string
          connected_by: string
          created_at: string
          id: string
          refresh_token: string
          token_expiry: string
          updated_at: string
        }
        Insert: {
          access_token: string
          connected_by: string
          created_at?: string
          id?: string
          refresh_token: string
          token_expiry: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          connected_by?: string
          created_at?: string
          id?: string
          refresh_token?: string
          token_expiry?: string
          updated_at?: string
        }
        Relationships: []
      }
      google_forms: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          fields: Json
          form_action_url: string
          form_url: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          form_action_url: string
          form_url: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          form_action_url?: string
          form_url?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      hireflix_retry_queue: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          next_retry_at: string
          operation: string
          payload: Json
          status: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          operation: string
          payload?: Json
          status?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          operation?: string
          payload?: Json
          status?: string
        }
        Relationships: []
      }
      integration_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
          integration: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          integration: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          integration?: string
        }
        Relationships: []
      }
      issues: {
        Row: {
          actual_behavior: string | null
          affected_area: string | null
          attachment_paths: string[] | null
          confidence_score: number | null
          created_at: string
          description: string
          expected_behavior: string | null
          frequency: string
          id: string
          issue_type: string
          retrieval_relevant: string | null
          severity: string
          steps_to_reproduce: string | null
          title: string
          updated_at: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          actual_behavior?: string | null
          affected_area?: string | null
          attachment_paths?: string[] | null
          confidence_score?: number | null
          created_at?: string
          description?: string
          expected_behavior?: string | null
          frequency?: string
          id?: string
          issue_type?: string
          retrieval_relevant?: string | null
          severity?: string
          steps_to_reproduce?: string | null
          title: string
          updated_at?: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          actual_behavior?: string | null
          affected_area?: string | null
          attachment_paths?: string[] | null
          confidence_score?: number | null
          created_at?: string
          description?: string
          expected_behavior?: string | null
          frequency?: string
          id?: string
          issue_type?: string
          retrieval_relevant?: string | null
          severity?: string
          steps_to_reproduce?: string | null
          title?: string
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      job_roles: {
        Row: {
          company_values: Json
          competencies: Json
          created_at: string
          created_by: string
          description: string | null
          hireflix_position_id: string | null
          id: string
          jd_storage_path: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          company_values?: Json
          competencies?: Json
          created_at?: string
          created_by: string
          description?: string | null
          hireflix_position_id?: string | null
          id?: string
          jd_storage_path?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          company_values?: Json
          competencies?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          hireflix_position_id?: string | null
          id?: string
          jd_storage_path?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      kb_document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          metadata: Json
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          metadata?: Json
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "kb_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_documents: {
        Row: {
          blob_path: string | null
          blob_url: string | null
          category: string | null
          chunk_count: number
          created_at: string
          error_message: string | null
          file_name: string
          file_type: string
          id: string
          owner_id: string
          scope: string
          status: string
          subcategory: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          blob_path?: string | null
          blob_url?: string | null
          category?: string | null
          chunk_count?: number
          created_at?: string
          error_message?: string | null
          file_name: string
          file_type: string
          id?: string
          owner_id: string
          scope: string
          status?: string
          subcategory?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          blob_path?: string | null
          blob_url?: string | null
          category?: string | null
          chunk_count?: number
          created_at?: string
          error_message?: string | null
          file_name?: string
          file_type?: string
          id?: string
          owner_id?: string
          scope?: string
          status?: string
          subcategory?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      key_event_approvals: {
        Row: {
          approval_type: string
          approver_profile_id: string | null
          created_at: string
          decided_at: string | null
          decision_note: string | null
          event_id: string
          id: string
          label: string | null
          proposed_date: string | null
          proposed_note: string | null
          requested_by: string
          status: Database["public"]["Enums"]["event_approval_status"]
          updated_at: string
        }
        Insert: {
          approval_type: string
          approver_profile_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          event_id: string
          id?: string
          label?: string | null
          proposed_date?: string | null
          proposed_note?: string | null
          requested_by: string
          status?: Database["public"]["Enums"]["event_approval_status"]
          updated_at?: string
        }
        Update: {
          approval_type?: string
          approver_profile_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          event_id?: string
          id?: string
          label?: string | null
          proposed_date?: string | null
          proposed_note?: string | null
          requested_by?: string
          status?: Database["public"]["Enums"]["event_approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "key_event_approvals_approver_profile_id_fkey"
            columns: ["approver_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_event_approvals_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "key_events"
            referencedColumns: ["id"]
          },
        ]
      }
      key_event_attachments: {
        Row: {
          created_at: string
          event_id: string
          file_name: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          event_id: string
          file_name: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          event_id?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "key_event_attachments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "key_events"
            referencedColumns: ["id"]
          },
        ]
      }
      key_event_goals: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number
          status: string
          target_date: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          status?: string
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          status?: string
          target_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      key_event_sync_log: {
        Row: {
          error: string | null
          events_flagged: number
          events_seen: number
          events_upserted: number
          finished_at: string | null
          id: string
          started_at: string
          status: string
        }
        Insert: {
          error?: string | null
          events_flagged?: number
          events_seen?: number
          events_upserted?: number
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
        }
        Update: {
          error?: string | null
          events_flagged?: number
          events_seen?: number
          events_upserted?: number
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      key_events: {
        Row: {
          all_day: boolean
          attendees: Json
          calendar_id: string
          category: string | null
          classification_confidence: number | null
          collaborators: Json
          created_at: string
          created_by: string | null
          decision_needed: string | null
          deleted_in_google: boolean
          end_at: string | null
          event_name: string | null
          google_event_id: string
          html_link: string | null
          id: string
          is_complete: boolean
          last_classified_at: string | null
          linked_docs: Json
          linked_goal_ids: string[]
          location: string | null
          missing_fields: string[]
          next_action: string | null
          objective: string | null
          organizer_email: string | null
          owner: string | null
          raw_description: string | null
          risk_level: string
          risk_reason: string | null
          risks: string | null
          start_at: string | null
          start_tz: string
          status: string | null
          success_metric: string | null
          synced_at: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          attendees?: Json
          calendar_id: string
          category?: string | null
          classification_confidence?: number | null
          collaborators?: Json
          created_at?: string
          created_by?: string | null
          decision_needed?: string | null
          deleted_in_google?: boolean
          end_at?: string | null
          event_name?: string | null
          google_event_id: string
          html_link?: string | null
          id?: string
          is_complete?: boolean
          last_classified_at?: string | null
          linked_docs?: Json
          linked_goal_ids?: string[]
          location?: string | null
          missing_fields?: string[]
          next_action?: string | null
          objective?: string | null
          organizer_email?: string | null
          owner?: string | null
          raw_description?: string | null
          risk_level?: string
          risk_reason?: string | null
          risks?: string | null
          start_at?: string | null
          start_tz?: string
          status?: string | null
          success_metric?: string | null
          synced_at?: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          attendees?: Json
          calendar_id?: string
          category?: string | null
          classification_confidence?: number | null
          collaborators?: Json
          created_at?: string
          created_by?: string | null
          decision_needed?: string | null
          deleted_in_google?: boolean
          end_at?: string | null
          event_name?: string | null
          google_event_id?: string
          html_link?: string | null
          id?: string
          is_complete?: boolean
          last_classified_at?: string | null
          linked_docs?: Json
          linked_goal_ids?: string[]
          location?: string | null
          missing_fields?: string[]
          next_action?: string | null
          objective?: string | null
          organizer_email?: string | null
          owner?: string | null
          raw_description?: string | null
          risk_level?: string
          risk_reason?: string | null
          risks?: string | null
          start_at?: string | null
          start_tz?: string
          status?: string | null
          success_metric?: string | null
          synced_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      lovable_usage_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          credit_limit: number | null
          id: string
          member_name: string
          period_credits: number
          period_label: string | null
          role: string | null
          snapshot_date: string
          total_credits: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          id?: string
          member_name: string
          period_credits?: number
          period_label?: string | null
          role?: string | null
          snapshot_date?: string
          total_credits?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          id?: string
          member_name?: string
          period_credits?: number
          period_label?: string | null
          role?: string | null
          snapshot_date?: string
          total_credits?: number
        }
        Relationships: []
      }
      meeting_participants: {
        Row: {
          created_at: string
          email: string | null
          id: string
          match_confidence: number | null
          meeting_id: string
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          match_confidence?: number | null
          meeting_id: string
          role?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          match_confidence?: number | null
          meeting_id?: string
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_requests: {
        Row: {
          calendar_event_id: string | null
          created_at: string
          gmail_message_id: string | null
          gmail_thread_id: string
          id: string
          last_polled_at: string | null
          original_email_body: string
          original_email_subject: string | null
          priority: string | null
          priority_reason: string | null
          proposed_slot: string | null
          proposed_slot_end: string | null
          purpose: string | null
          sender_email: string
          sender_name: string
          status: string
          updated_at: string
        }
        Insert: {
          calendar_event_id?: string | null
          created_at?: string
          gmail_message_id?: string | null
          gmail_thread_id: string
          id?: string
          last_polled_at?: string | null
          original_email_body: string
          original_email_subject?: string | null
          priority?: string | null
          priority_reason?: string | null
          proposed_slot?: string | null
          proposed_slot_end?: string | null
          purpose?: string | null
          sender_email: string
          sender_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          calendar_event_id?: string | null
          created_at?: string
          gmail_message_id?: string | null
          gmail_thread_id?: string
          id?: string
          last_polled_at?: string | null
          original_email_body?: string
          original_email_subject?: string | null
          priority?: string | null
          priority_reason?: string | null
          proposed_slot?: string | null
          proposed_slot_end?: string | null
          purpose?: string | null
          sender_email?: string
          sender_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      meetings: {
        Row: {
          action_items: Json | null
          analysis: Json | null
          attendee_emails: string[] | null
          audio_storage_path: string | null
          created_at: string
          email_subject: string | null
          fetched_by: string | null
          gmail_message_id: string | null
          host_email: string | null
          host_user_id: string | null
          id: string
          meeting_date: string | null
          participants: string[] | null
          sender_email: string | null
          source: string
          status: string
          summary: string | null
          title: string
          transcript: string | null
          updated_at: string
        }
        Insert: {
          action_items?: Json | null
          analysis?: Json | null
          attendee_emails?: string[] | null
          audio_storage_path?: string | null
          created_at?: string
          email_subject?: string | null
          fetched_by?: string | null
          gmail_message_id?: string | null
          host_email?: string | null
          host_user_id?: string | null
          id?: string
          meeting_date?: string | null
          participants?: string[] | null
          sender_email?: string | null
          source?: string
          status?: string
          summary?: string | null
          title: string
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          action_items?: Json | null
          analysis?: Json | null
          attendee_emails?: string[] | null
          audio_storage_path?: string | null
          created_at?: string
          email_subject?: string | null
          fetched_by?: string | null
          gmail_message_id?: string | null
          host_email?: string | null
          host_user_id?: string | null
          id?: string
          meeting_date?: string | null
          participants?: string[] | null
          sender_email?: string | null
          source?: string
          status?: string
          summary?: string | null
          title?: string
          transcript?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nda_submissions: {
        Row: {
          created_at: string
          date_of_agreement: string
          docusign_envelope_id: string | null
          google_doc_id: string | null
          google_doc_url: string | null
          id: string
          internal_signer_email: string | null
          internal_signer_name: string | null
          last_error: string | null
          notion_page_id: string | null
          notion_page_url: string | null
          purpose: string
          receiving_party_entity: string
          receiving_party_name: string
          recipient_email: string
          recipient_name: string
          registered_address: string
          status: string
          submitter_email: string | null
          submitter_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_of_agreement: string
          docusign_envelope_id?: string | null
          google_doc_id?: string | null
          google_doc_url?: string | null
          id?: string
          internal_signer_email?: string | null
          internal_signer_name?: string | null
          last_error?: string | null
          notion_page_id?: string | null
          notion_page_url?: string | null
          purpose: string
          receiving_party_entity: string
          receiving_party_name: string
          recipient_email: string
          recipient_name: string
          registered_address: string
          status?: string
          submitter_email?: string | null
          submitter_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_of_agreement?: string
          docusign_envelope_id?: string | null
          google_doc_id?: string | null
          google_doc_url?: string | null
          id?: string
          internal_signer_email?: string | null
          internal_signer_name?: string | null
          last_error?: string | null
          notion_page_id?: string | null
          notion_page_url?: string | null
          purpose?: string
          receiving_party_entity?: string
          receiving_party_name?: string
          recipient_email?: string
          recipient_name?: string
          registered_address?: string
          status?: string
          submitter_email?: string | null
          submitter_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          metadata: Json
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          metadata?: Json
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          metadata?: Json
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approval_status: string
          avatar_url: string | null
          bio: string | null
          created_at: string
          department: string | null
          display_name: string | null
          id: string
          norman_context: string | null
          onboarding_completed_at: string | null
          onboarding_step: string
          preferences: Json | null
          requested_role_title: string | null
          role_title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approval_status?: string
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          department?: string | null
          display_name?: string | null
          id?: string
          norman_context?: string | null
          onboarding_completed_at?: string | null
          onboarding_step?: string
          preferences?: Json | null
          requested_role_title?: string | null
          role_title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approval_status?: string
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          department?: string | null
          display_name?: string | null
          id?: string
          norman_context?: string | null
          onboarding_completed_at?: string | null
          onboarding_step?: string
          preferences?: Json | null
          requested_role_title?: string | null
          role_title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_chat_plan_items: {
        Row: {
          assignee_profile_id: string | null
          chat_id: string
          created_at: string
          created_by: string
          due_date: string | null
          group_title: string | null
          id: string
          notes: string | null
          position: number
          project_id: string
          promoted_card_id: string | null
          promoted_task_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_profile_id?: string | null
          chat_id: string
          created_at?: string
          created_by: string
          due_date?: string | null
          group_title?: string | null
          id?: string
          notes?: string | null
          position?: number
          project_id: string
          promoted_card_id?: string | null
          promoted_task_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_profile_id?: string | null
          chat_id?: string
          created_at?: string
          created_by?: string
          due_date?: string | null
          group_title?: string | null
          id?: string
          notes?: string | null
          position?: number
          project_id?: string
          promoted_card_id?: string | null
          promoted_task_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_chat_plan_items_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "project_chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_chat_plan_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_chats: {
        Row: {
          created_at: string
          id: string
          project_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          title?: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_chats_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_file_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          file_id: string
          id: string
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          embedding?: string | null
          file_id: string
          id?: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          file_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_file_chunks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
        ]
      }
      project_files: {
        Row: {
          azure_blob_path: string | null
          created_at: string
          extracted_text: string | null
          file_name: string
          id: string
          project_id: string
          storage_path: string
        }
        Insert: {
          azure_blob_path?: string | null
          created_at?: string
          extracted_text?: string | null
          file_name: string
          id?: string
          project_id: string
          storage_path: string
        }
        Update: {
          azure_blob_path?: string | null
          created_at?: string
          extracted_text?: string | null
          file_name?: string
          id?: string
          project_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          added_by: string
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_note_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          note_id: string
          project_id: string
          size_bytes: number | null
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          note_id: string
          project_id: string
          size_bytes?: number | null
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          note_id?: string
          project_id?: string
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_note_attachments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "project_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_note_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_note_folders: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          parent_folder_id: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          parent_folder_id?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          parent_folder_id?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_note_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "project_note_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_note_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_notes: {
        Row: {
          content: string
          created_at: string
          created_by: string
          folder_id: string | null
          id: string
          pinned: boolean
          project_id: string
          title: string
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          created_by: string
          folder_id?: string | null
          id?: string
          pinned?: boolean
          project_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          folder_id?: string | null
          id?: string
          pinned?: boolean
          project_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_notes_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "project_note_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          id: string
          name: string
          note_template: string | null
          system_prompt: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          note_template?: string | null
          system_prompt?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          note_template?: string | null
          system_prompt?: string | null
          user_id?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          approval_tier: string | null
          approved_at: string | null
          approved_by: string | null
          approver_user_id: string | null
          attachment_path: string | null
          category: Database["public"]["Enums"]["po_category"]
          created_at: string
          delivery_date: string | null
          department_id: string
          description: string
          id: string
          notes: string | null
          po_number: string
          quantity: number
          rejection_reason: string | null
          requester_id: string
          secondary_approved_at: string | null
          secondary_approved_by: string | null
          secondary_approver_user_id: string | null
          status: Database["public"]["Enums"]["po_status"]
          total_amount: number
          unit_price: number
          updated_at: string
          vendor_name: string
        }
        Insert: {
          approval_tier?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approver_user_id?: string | null
          attachment_path?: string | null
          category?: Database["public"]["Enums"]["po_category"]
          created_at?: string
          delivery_date?: string | null
          department_id: string
          description: string
          id?: string
          notes?: string | null
          po_number: string
          quantity?: number
          rejection_reason?: string | null
          requester_id: string
          secondary_approved_at?: string | null
          secondary_approved_by?: string | null
          secondary_approver_user_id?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          total_amount: number
          unit_price: number
          updated_at?: string
          vendor_name: string
        }
        Update: {
          approval_tier?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approver_user_id?: string | null
          attachment_path?: string | null
          category?: Database["public"]["Enums"]["po_category"]
          created_at?: string
          delivery_date?: string | null
          department_id?: string
          description?: string
          id?: string
          notes?: string | null
          po_number?: string
          quantity?: number
          rejection_reason?: string | null
          requester_id?: string
          secondary_approved_at?: string | null
          secondary_approved_by?: string | null
          secondary_approver_user_id?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          total_amount?: number
          unit_price?: number
          updated_at?: string
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      release_email_logs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          recipient_email: string
          release_id: string
          sent_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_email: string
          release_id: string
          sent_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_email?: string
          release_id?: string
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_email_logs_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
        ]
      }
      releases: {
        Row: {
          changes: Json
          created_at: string
          created_by: string
          id: string
          published_at: string | null
          published_by: string | null
          status: string
          summary: string
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          changes?: Json
          created_at?: string
          created_by: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          summary?: string
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          changes?: Json
          created_at?: string
          created_by?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          summary?: string
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      school_registrations: {
        Row: {
          contact_name: string
          created_at: string
          email: string
          id: string
          notes: string | null
          number_of_schools: number | null
          phone: string
          role: string | null
          school_name: string
        }
        Insert: {
          contact_name: string
          created_at?: string
          email: string
          id?: string
          notes?: string | null
          number_of_schools?: number | null
          phone: string
          role?: string | null
          school_name: string
        }
        Update: {
          contact_name?: string
          created_at?: string
          email?: string
          id?: string
          notes?: string | null
          number_of_schools?: number | null
          phone?: string
          role?: string | null
          school_name?: string
        }
        Relationships: []
      }
      slack_connections: {
        Row: {
          access_token: string
          authed_user_id: string | null
          created_at: string
          id: string
          scope: string | null
          team_id: string
          team_name: string | null
          updated_at: string
          user_access_token: string | null
          user_id: string
          user_scope: string | null
          user_token_type: string | null
        }
        Insert: {
          access_token: string
          authed_user_id?: string | null
          created_at?: string
          id?: string
          scope?: string | null
          team_id: string
          team_name?: string | null
          updated_at?: string
          user_access_token?: string | null
          user_id: string
          user_scope?: string | null
          user_token_type?: string | null
        }
        Update: {
          access_token?: string
          authed_user_id?: string | null
          created_at?: string
          id?: string
          scope?: string | null
          team_id?: string
          team_name?: string | null
          updated_at?: string
          user_access_token?: string | null
          user_id?: string
          user_scope?: string | null
          user_token_type?: string | null
        }
        Relationships: []
      }
      slack_notification_logs: {
        Row: {
          created_at: string
          event_key: string | null
          id: string
          payload: Json
          sent_at: string | null
          slack_user_identifier: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_key?: string | null
          id?: string
          payload?: Json
          sent_at?: string | null
          slack_user_identifier: string
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_key?: string | null
          id?: string
          payload?: Json
          sent_at?: string | null
          slack_user_identifier?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slack_notification_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_stats_snapshots: {
        Row: {
          account: string
          channel: string | null
          comments: number | null
          created_at: string
          engagement_rate: number | null
          fetched_at: string
          followers: number | null
          id: string
          impressions: number | null
          likes: number | null
          posts: number | null
          prev_comments: number | null
          prev_followers: number | null
          prev_likes: number | null
          prev_posts: number | null
          prev_shares: number | null
          raw: Json | null
          shares: number | null
          source_email_date: string | null
          source_filename: string | null
          source_message_id: string | null
          week_label: string | null
          week_start: string | null
        }
        Insert: {
          account: string
          channel?: string | null
          comments?: number | null
          created_at?: string
          engagement_rate?: number | null
          fetched_at?: string
          followers?: number | null
          id?: string
          impressions?: number | null
          likes?: number | null
          posts?: number | null
          prev_comments?: number | null
          prev_followers?: number | null
          prev_likes?: number | null
          prev_posts?: number | null
          prev_shares?: number | null
          raw?: Json | null
          shares?: number | null
          source_email_date?: string | null
          source_filename?: string | null
          source_message_id?: string | null
          week_label?: string | null
          week_start?: string | null
        }
        Update: {
          account?: string
          channel?: string | null
          comments?: number | null
          created_at?: string
          engagement_rate?: number | null
          fetched_at?: string
          followers?: number | null
          id?: string
          impressions?: number | null
          likes?: number | null
          posts?: number | null
          prev_comments?: number | null
          prev_followers?: number | null
          prev_likes?: number | null
          prev_posts?: number | null
          prev_shares?: number | null
          raw?: Json | null
          shares?: number | null
          source_email_date?: string | null
          source_filename?: string | null
          source_message_id?: string | null
          week_label?: string | null
          week_start?: string | null
        }
        Relationships: []
      }
      supplier_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          name: string
          phone: string | null
          role: string | null
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          phone?: string | null
          role?: string | null
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          phone?: string | null
          role?: string | null
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_contacts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_workstreams: {
        Row: {
          created_at: string
          id: string
          supplier_id: string
          workstream_card_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          supplier_id: string
          workstream_card_id: string
        }
        Update: {
          created_at?: string
          id?: string
          supplier_id?: string
          workstream_card_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_workstreams_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contract_status: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          id: string
          logo_url: string | null
          name: string
          notes: string | null
          rate: string | null
          renewal_date: string | null
          services: string[]
          type: string
          updated_at: string
          website: string | null
        }
        Insert: {
          contract_status?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          logo_url?: string | null
          name: string
          notes?: string | null
          rate?: string | null
          renewal_date?: string | null
          services?: string[]
          type?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          contract_status?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          notes?: string | null
          rate?: string | null
          renewal_date?: string | null
          services?: string[]
          type?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          integration: string
          records_synced: number | null
          started_at: string
          status: string
          sync_type: string
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          integration: string
          records_synced?: number | null
          started_at?: string
          status?: string
          sync_type: string
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          integration?: string
          records_synced?: number | null
          started_at?: string
          status?: string
          sync_type?: string
          triggered_by?: string | null
        }
        Relationships: []
      }
      token_usage: {
        Row: {
          completion_tokens: number
          created_at: string
          id: string
          prompt_tokens: number
          request_count: number
          total_tokens: number
          updated_at: string
          usage_date: string
          user_id: string
        }
        Insert: {
          completion_tokens?: number
          created_at?: string
          id?: string
          prompt_tokens?: number
          request_count?: number
          total_tokens?: number
          updated_at?: string
          usage_date?: string
          user_id: string
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          id?: string
          prompt_tokens?: number
          request_count?: number
          total_tokens?: number
          updated_at?: string
          usage_date?: string
          user_id?: string
        }
        Relationships: []
      }
      travel_requests: {
        Row: {
          accommodation_needed: boolean
          accommodation_type: string | null
          approved_at: string | null
          approved_by: string | null
          approver_user_id: string | null
          attachment_path: string | null
          created_at: string
          currency: string
          depart_date: string
          destination_city: string
          destination_country: string
          estimated_cost: number
          id: string
          notes: string | null
          purpose: string
          reference: string
          rejection_reason: string | null
          requester_id: string
          return_date: string
          status: Database["public"]["Enums"]["travel_status"]
          transport_mode: Database["public"]["Enums"]["travel_transport"]
          traveller_name: string
          traveller_user_id: string | null
          updated_at: string
        }
        Insert: {
          accommodation_needed?: boolean
          accommodation_type?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approver_user_id?: string | null
          attachment_path?: string | null
          created_at?: string
          currency?: string
          depart_date: string
          destination_city: string
          destination_country: string
          estimated_cost?: number
          id?: string
          notes?: string | null
          purpose: string
          reference: string
          rejection_reason?: string | null
          requester_id: string
          return_date: string
          status?: Database["public"]["Enums"]["travel_status"]
          transport_mode?: Database["public"]["Enums"]["travel_transport"]
          traveller_name: string
          traveller_user_id?: string | null
          updated_at?: string
        }
        Update: {
          accommodation_needed?: boolean
          accommodation_type?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approver_user_id?: string | null
          attachment_path?: string | null
          created_at?: string
          currency?: string
          depart_date?: string
          destination_city?: string
          destination_country?: string
          estimated_cost?: number
          id?: string
          notes?: string | null
          purpose?: string
          reference?: string
          rejection_reason?: string | null
          requester_id?: string
          return_date?: string
          status?: Database["public"]["Enums"]["travel_status"]
          transport_mode?: Database["public"]["Enums"]["travel_transport"]
          traveller_name?: string
          traveller_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      unmapped_users_log: {
        Row: {
          basecamp_name: string
          basecamp_person_id: number
          context: string | null
          id: string
          logged_at: string
        }
        Insert: {
          basecamp_name: string
          basecamp_person_id: number
          context?: string | null
          id?: string
          logged_at?: string
        }
        Update: {
          basecamp_name?: string
          basecamp_person_id?: number
          context?: string | null
          id?: string
          logged_at?: string
        }
        Relationships: []
      }
      user_integrations: {
        Row: {
          created_at: string
          documents_ingested: number | null
          encrypted_api_key: string
          id: string
          integration_id: string
          last_sync: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          documents_ingested?: number | null
          encrypted_api_key: string
          id?: string
          integration_id: string
          last_sync?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          documents_ingested?: number | null
          encrypted_api_key?: string
          id?: string
          integration_id?: string
          last_sync?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notification_mappings: {
        Row: {
          basecamp_name: string
          basecamp_person_id: number
          created_at: string
          duncan_user_id: string
          id: string
          is_active: boolean
          slack_user_identifier: string
          updated_at: string
        }
        Insert: {
          basecamp_name: string
          basecamp_person_id: number
          created_at?: string
          duncan_user_id: string
          id?: string
          is_active?: boolean
          slack_user_identifier: string
          updated_at?: string
        }
        Update: {
          basecamp_name?: string
          basecamp_person_id?: number
          created_at?: string
          duncan_user_id?: string
          id?: string
          is_active?: boolean
          slack_user_identifier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notification_mappings_duncan_user_id_fkey"
            columns: ["duncan_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wiki_categories: {
        Row: {
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      wiki_pages: {
        Row: {
          category_id: string | null
          content: string
          created_at: string
          created_by: string
          id: string
          is_published: boolean
          sort_order: number
          summary: string | null
          tags: string[] | null
          title: string
          updated_at: string
          updated_by: string | null
          view_count: number
        }
        Insert: {
          category_id?: string | null
          content?: string
          created_at?: string
          created_by: string
          id?: string
          is_published?: boolean
          sort_order?: number
          summary?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
          updated_by?: string | null
          view_count?: number
        }
        Update: {
          category_id?: string | null
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          is_published?: boolean
          sort_order?: number
          summary?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "wiki_pages_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "wiki_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_activity: {
        Row: {
          action: string
          card_id: string
          created_at: string
          details: Json
          id: string
          user_id: string
        }
        Insert: {
          action: string
          card_id: string
          created_at?: string
          details?: Json
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          card_id?: string
          created_at?: string
          details?: Json
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstream_activity_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "workstream_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_card_assignees: {
        Row: {
          assignment_status: string
          card_id: string
          created_at: string
          decline_reason: string | null
          id: string
          responded_at: string | null
          user_id: string
        }
        Insert: {
          assignment_status?: string
          card_id: string
          created_at?: string
          decline_reason?: string | null
          id?: string
          responded_at?: string | null
          user_id: string
        }
        Update: {
          assignment_status?: string
          card_id?: string
          created_at?: string
          decline_reason?: string | null
          id?: string
          responded_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstream_card_assignees_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "workstream_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_cards: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          description: string
          due_date: string | null
          id: string
          manual_status_set_at: string | null
          owner_id: string | null
          priority: string
          project_tag: string | null
          status: string
          status_source: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          description?: string
          due_date?: string | null
          id?: string
          manual_status_set_at?: string | null
          owner_id?: string | null
          priority?: string
          project_tag?: string | null
          status?: string
          status_source?: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          description?: string
          due_date?: string | null
          id?: string
          manual_status_set_at?: string | null
          owner_id?: string | null
          priority?: string
          project_tag?: string | null
          status?: string
          status_source?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      workstream_comments: {
        Row: {
          card_id: string
          content: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          card_id: string
          content: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          card_id?: string
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstream_comments_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "workstream_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_task_assignees: {
        Row: {
          created_at: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstream_task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "workstream_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_task_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          task_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          task_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          task_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstream_task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "workstream_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_task_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstream_task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "workstream_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_tasks: {
        Row: {
          assignee_id: string | null
          card_id: string
          completed: boolean
          created_at: string
          description: string
          due_date: string | null
          id: string
          parent_task_id: string | null
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          card_id: string
          completed?: boolean
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          parent_task_id?: string | null
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          card_id?: string
          completed?: boolean
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          parent_task_id?: string | null
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstream_tasks_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "workstream_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstream_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "workstream_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      xero_contacts: {
        Row: {
          contact_status: string | null
          created_at: string
          email: string | null
          external_id: string
          id: string
          is_customer: boolean | null
          is_supplier: boolean | null
          name: string
          outstanding_balance: number | null
          overdue_balance: number | null
          phone: string | null
          raw_data: Json | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          contact_status?: string | null
          created_at?: string
          email?: string | null
          external_id: string
          id?: string
          is_customer?: boolean | null
          is_supplier?: boolean | null
          name: string
          outstanding_balance?: number | null
          overdue_balance?: number | null
          phone?: string | null
          raw_data?: Json | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          contact_status?: string | null
          created_at?: string
          email?: string | null
          external_id?: string
          id?: string
          is_customer?: boolean | null
          is_supplier?: boolean | null
          name?: string
          outstanding_balance?: number | null
          overdue_balance?: number | null
          phone?: string | null
          raw_data?: Json | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      xero_invoices: {
        Row: {
          amount_due: number | null
          amount_paid: number | null
          contact_id: string | null
          contact_name: string | null
          created_at: string
          currency_code: string | null
          date: string | null
          due_date: string | null
          external_id: string
          id: string
          invoice_number: string | null
          line_items: Json | null
          raw_data: Json | null
          status: string | null
          synced_at: string
          total: number | null
          type: string | null
          updated_at: string
        }
        Insert: {
          amount_due?: number | null
          amount_paid?: number | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string
          currency_code?: string | null
          date?: string | null
          due_date?: string | null
          external_id: string
          id?: string
          invoice_number?: string | null
          line_items?: Json | null
          raw_data?: Json | null
          status?: string | null
          synced_at?: string
          total?: number | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          amount_due?: number | null
          amount_paid?: number | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string
          currency_code?: string | null
          date?: string | null
          due_date?: string | null
          external_id?: string
          id?: string
          invoice_number?: string | null
          line_items?: Json | null
          raw_data?: Json | null
          status?: string | null
          synced_at?: string
          total?: number | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      xero_tokens: {
        Row: {
          access_token: string
          connected_by: string
          created_at: string
          id: string
          refresh_token: string
          tenant_id: string | null
          token_expiry: string
          updated_at: string
        }
        Insert: {
          access_token: string
          connected_by: string
          created_at?: string
          id?: string
          refresh_token: string
          tenant_id?: string | null
          token_expiry: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          connected_by?: string
          created_at?: string
          id?: string
          refresh_token?: string
          tenant_id?: string | null
          token_expiry?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      backfill_meeting_ownership: {
        Args: never
        Returns: {
          host_set: boolean
          matched_users: number
          meeting_id: string
          participants_inserted: number
        }[]
      }
      call_edge_function_with_service_role: {
        Args: { body?: Json; function_name: string }
        Returns: number
      }
      can_access_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      get_action_items_around: {
        Args: { _days_back?: number; _meeting_id: string }
        Returns: Json
      }
      get_action_items_for_range: {
        Args: { _from_date: string; _to_date: string }
        Returns: Json
      }
      get_company_integration_secret: {
        Args: { p_integration_id: string }
        Returns: string
      }
      get_company_integrations_status: {
        Args: never
        Returns: {
          created_at: string
          documents_ingested: number
          id: string
          integration_id: string
          last_sync: string
          status: string
          updated_at: string
          updated_by: string
        }[]
      }
      get_duncan_calendar_status: {
        Args: never
        Returns: {
          calendar_id: string
          calendar_name: string
          connected: boolean
          google_account_email: string
          last_updated: string
        }[]
      }
      get_duncan_gmail_status: {
        Args: never
        Returns: {
          connected: boolean
          google_account_email: string
          last_updated: string
          scopes: string
        }[]
      }
      get_my_meetings: {
        Args: { _limit?: number; _scope?: string }
        Returns: {
          action_items: Json | null
          analysis: Json | null
          attendee_emails: string[] | null
          audio_storage_path: string | null
          created_at: string
          email_subject: string | null
          fetched_by: string | null
          gmail_message_id: string | null
          host_email: string | null
          host_user_id: string | null
          id: string
          meeting_date: string | null
          participants: string[] | null
          sender_email: string | null
          source: string
          status: string
          summary: string | null
          title: string
          transcript: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "meetings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_documents: {
        Args: {
          match_count?: number
          match_threshold?: number
          p_user_id?: string
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          document_id: string
          document_title: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      match_project_chunks: {
        Args: {
          file_ids: string[]
          match_count?: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          file_id: string
          id: string
          similarity: number
        }[]
      }
      set_company_integration_secret: {
        Args: { p_integration_id: string; p_plaintext: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      approval_kind:
        | "cost"
        | "event_date"
        | "release"
        | "hire"
        | "contract"
        | "other"
      approval_status:
        | "pending"
        | "approved"
        | "rejected"
        | "changes_requested"
        | "cancelled"
      chat_write_status:
        | "pending"
        | "confirmed"
        | "executed"
        | "cancelled"
        | "failed"
        | "expired"
      event_approval_status: "pending" | "approved" | "rejected" | "proposed"
      po_category:
        | "software"
        | "hardware"
        | "services"
        | "marketing"
        | "travel"
        | "office_supplies"
        | "other"
        | "creative"
        | "events"
        | "social"
        | "manufacturing"
      po_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "rejected"
        | "cancelled"
      travel_status: "pending_approval" | "approved" | "rejected" | "cancelled"
      travel_transport: "flight" | "train" | "car" | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      approval_kind: [
        "cost",
        "event_date",
        "release",
        "hire",
        "contract",
        "other",
      ],
      approval_status: [
        "pending",
        "approved",
        "rejected",
        "changes_requested",
        "cancelled",
      ],
      chat_write_status: [
        "pending",
        "confirmed",
        "executed",
        "cancelled",
        "failed",
        "expired",
      ],
      event_approval_status: ["pending", "approved", "rejected", "proposed"],
      po_category: [
        "software",
        "hardware",
        "services",
        "marketing",
        "travel",
        "office_supplies",
        "other",
        "creative",
        "events",
        "social",
        "manufacturing",
      ],
      po_status: [
        "draft",
        "pending_approval",
        "approved",
        "rejected",
        "cancelled",
      ],
      travel_status: ["pending_approval", "approved", "rejected", "cancelled"],
      travel_transport: ["flight", "train", "car", "other"],
    },
  },
} as const
