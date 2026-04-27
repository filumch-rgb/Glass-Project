import { InternalStatus, ExternalStatus } from '../types';

/**
 * Status Service for Glass Claim Assessment System
 * 
 * Implements the dual status model where external status is ALWAYS derived
 * from internal status and NEVER stored independently.
 * 
 * This ensures consistency and prevents status drift.
 */

export class StatusService {
  /**
   * Status mapping table from design.md
   * Maps internal status to external (user-friendly) status
   */
  private static readonly STATUS_MAP: Record<InternalStatus, ExternalStatus> = {
    intake_received: 'Message Sent',
    intake_validated: 'Message Sent',
    intake_failed: 'Needs Action',
    journey_created: 'Message Sent',
    notification_sent: 'Message Sent',
    notification_opened: 'Message Opened',
    awaiting_consent: 'Message Opened',
    awaiting_photos: 'Photos In Progress',
    validating_photos: 'Photos In Progress',
    photos_validated: 'Photos Submitted',
    photos_insufficient: 'Needs Action',
    vin_enrichment_pending: 'Under Review',
    vin_enrichment_complete: 'Under Review',
    damage_analysis_pending: 'Under Review',
    damage_analysis_complete: 'Under Review',
    decision_pending: 'Under Review',
    manual_review_required: 'Under Review',
    decision_complete: 'Result Ready',
    result_delivered: 'Result Ready',
    failed_validation: 'Needs Action',
    failed_processing: 'Needs Action',
    abandoned: 'Abandoned',
  };

  /**
   * Derive external status from internal status
   * 
   * This is the ONLY way to get external status - it is never stored.
   * 
   * @param internalStatus - The internal status of the claim
   * @returns The derived external status
   */
  static deriveExternalStatus(internalStatus: InternalStatus): ExternalStatus {
    const externalStatus = this.STATUS_MAP[internalStatus];
    
    if (!externalStatus) {
      throw new Error(`Unknown internal status: ${internalStatus}`);
    }

    return externalStatus;
  }

  /**
   * Get all valid internal statuses
   */
  static getAllInternalStatuses(): InternalStatus[] {
    return Object.keys(this.STATUS_MAP) as InternalStatus[];
  }

  /**
   * Get all valid external statuses
   */
  static getAllExternalStatuses(): ExternalStatus[] {
    return Array.from(new Set(Object.values(this.STATUS_MAP)));
  }

  /**
   * Check if an internal status is valid
   */
  static isValidInternalStatus(status: string): status is InternalStatus {
    return status in this.STATUS_MAP;
  }

  /**
   * Get all internal statuses that map to a given external status
   */
  static getInternalStatusesForExternal(externalStatus: ExternalStatus): InternalStatus[] {
    return Object.entries(this.STATUS_MAP)
      .filter(([_, external]) => external === externalStatus)
      .map(([internal, _]) => internal as InternalStatus);
  }

  /**
   * Validate status transition (optional - for future use)
   * Can be extended to enforce valid state transitions
   */
  static isValidTransition(from: InternalStatus, to: InternalStatus): boolean {
    // For now, allow all transitions
    // Can be extended with a state machine in the future
    return true;
  }
}

// Export singleton for convenience
export const statusService = StatusService;
