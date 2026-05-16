/**
 * Dashboard API Routes for Insurer Interface
 * 
 * Provides endpoints for:
 * - Claims listing with filters
 * - Claim details with photos
 * - Manual review triggers
 * - Dashboard metrics
 * - Export functionality (CSV/JSON)
 * - Simple access code authentication
 */

import { Router, Request, Response } from 'express';
import { database } from '../config/database';
import { loggers } from '../utils/logger';
import { manualReviewService } from '../services/manualReviewService';
import { DecisionResult } from '../services/decisionRulesEngine';

const router = Router();

// Simple access code for POC (in production, use proper authentication)
const ACCESS_CODE = process.env.DASHBOARD_ACCESS_CODE || 'glass2024';

/**
 * Middleware: Verify access code
 */
function verifyAccessCode(req: Request, res: Response, next: Function): void {
  const accessCode = req.headers['x-access-code'] || req.query.accessCode;
  
  if (accessCode !== ACCESS_CODE) {
    res.status(401).json({ error: 'Invalid access code' });
    return;
  }
  
  next();
}

/**
 * POST /api/dashboard/auth
 * Validate access code
 */
router.post('/auth', async (req: Request, res: Response) => {
  try {
    const { accessCode } = req.body;
    
    if (accessCode === ACCESS_CODE) {
      return res.json({ 
        success: true,
        message: 'Access granted'
      });
    }
    
    return res.status(401).json({ 
      success: false,
      error: 'Invalid access code' 
    });
  } catch (error) {
    loggers.app.error('Auth error', error as Error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * GET /api/dashboard/claims
 * Get all claims with optional filters
 * 
 * Query params:
 * - status: Filter by external status
 * - decision: Filter by decision outcome (repair/replace/needs_manual_review)
 * - dateFrom: Filter by date range (ISO string)
 * - dateTo: Filter by date range (ISO string)
 * - limit: Number of results (default 100)
 * - offset: Pagination offset (default 0)
 */
router.get('/claims', verifyAccessCode, async (req: Request, res: Response) => {
  try {
    const { status, decision, dateFrom, dateTo, limit = '100', offset = '0' } = req.query;
    
    let query = `
      SELECT 
        ci.id,
        ci.claim_number,
        ci.insurer_id,
        ci.external_status,
        ci.internal_status,
        ci.policyholder_name,
        ci.policyholder_mobile,
        ci.policyholder_email,
        ci.received_at,
        ci.created_at,
        ci.updated_at,
        ci.inspection_data,
        nd.sent_at as notification_sent_at,
        nd.status as notification_status,
        (SELECT MIN(uploaded_at) FROM uploaded_photos WHERE claim_id::text = ci.id::text) as first_response_at
      FROM claim_inspections ci
      LEFT JOIN notification_deliveries nd ON ci.id::text = nd.claim_id
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let paramIndex = 1;
    
    // Filter by status
    if (status) {
      query += ` AND ci.external_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    // Filter by decision (from inspection_data JSONB)
    if (decision) {
      query += ` AND ci.inspection_data->>'decision' = $${paramIndex}`;
      params.push(decision);
      paramIndex++;
    }
    
    // Filter by date range
    if (dateFrom) {
      query += ` AND ci.received_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }
    
    if (dateTo) {
      query += ` AND ci.received_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }
    
    // Order by received date (most recent first)
    query += ` ORDER BY ci.received_at DESC`;
    
    // Pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));
    
    const result = await database.query(query, params);
    
    // Transform results
    const claims = result.rows.map((row: any) => {
      const inspectionData = row.inspection_data || {};
      const decision = inspectionData.decision || null;
      const confidence = decision?.confidenceSummary 
        ? (Object.values(decision.confidenceSummary as Record<string, number>).reduce((a, b) => a + b, 0) / Object.values(decision.confidenceSummary as Record<string, number>).length)
        : null;
      
      return {
        id: row.id,
        claimNumber: row.claim_number,
        insurerId: row.insurer_id,
        policyholderName: row.policyholder_name,
        policyholderMobile: row.policyholder_mobile,
        policyholderEmail: row.policyholder_email,
        status: row.external_status,
        internalStatus: row.internal_status,
        decision: decision?.outcome || null,
        decisionExplanation: decision?.justification || null,
        confidence: confidence,
        receivedAt: row.received_at,
        notificationSentAt: row.notification_sent_at,
        notificationStatus: row.notification_status,
        responseReceivedAt: row.first_response_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
    
    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) FROM claim_inspections WHERE 1=1`;
    const countResult = await database.query(countQuery);
    const totalCount = parseInt(countResult.rows[0].count);
    
    return res.json({
      claims,
      pagination: {
        total: totalCount,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      },
    });
  } catch (error) {
    loggers.app.error('Failed to fetch claims', error as Error);
    return res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

/**
 * GET /api/dashboard/claims/:claimId
 * Get detailed claim information including photos
 */
router.get('/claims/:claimId', verifyAccessCode, async (req: Request, res: Response) => {
  try {
    const { claimId } = req.params;
    
    if (!claimId) {
      return res.status(400).json({ error: 'Claim ID is required' });
    }
    
    // Get claim details
    const claimResult = await database.query(
      `
      SELECT 
        ci.*,
        nd.sent_at as notification_sent_at,
        nd.status as notification_status,
        nd.provider_message_id
      FROM claim_inspections ci
      LEFT JOIN notification_deliveries nd ON ci.id::text = nd.claim_id
      WHERE ci.id = $1
    `,
      [claimId]
    );
    
    if (claimResult.rowCount === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    
    const claim = claimResult.rows[0];
    
    // Get photos
    const photosResult = await database.query(
      `
      SELECT 
        id,
        photo_slot,
        file_path,
        uploaded_at,
        validation_outcome,
        validation_details
      FROM uploaded_photos
      WHERE claim_id = $1
      ORDER BY uploaded_at ASC
    `,
      [claimId]
    );
    
    // Get manual review if exists
    const manualReview = await manualReviewService.getManualReviewByClaimId(claimId);
    
    const inspectionData = claim.inspection_data || {};
    
    return res.json({
      id: claim.id,
      claimNumber: claim.claim_number,
      insurerId: claim.insurer_id,
      policyholderName: claim.policyholder_name,
      policyholderMobile: claim.policyholder_mobile,
      policyholderEmail: claim.policyholder_email,
      insurerProvidedVin: claim.insurer_provided_vin,
      status: claim.external_status,
      internalStatus: claim.internal_status,
      consentCaptured: claim.consent_captured,
      receivedAt: claim.received_at,
      notificationSentAt: claim.notification_sent_at,
      notificationStatus: claim.notification_status,
      createdAt: claim.created_at,
      updatedAt: claim.updated_at,
      inspectionData,
      photos: photosResult.rows,
      manualReview: manualReview ? {
        reviewId: manualReview.reviewId,
        triggerSource: manualReview.triggerSource,
        priority: manualReview.priority,
        queuedAt: manualReview.queuedAt,
        reviewStartedAt: manualReview.reviewStartedAt,
        reviewCompletedAt: manualReview.reviewCompletedAt,
        reviewerAction: manualReview.reviewerAction,
        finalReviewedOutcome: manualReview.finalReviewedOutcome,
        overrideFlag: manualReview.overrideFlag,
      } : null,
    });
  } catch (error) {
    loggers.app.error('Failed to fetch claim details', error as Error);
    return res.status(500).json({ error: 'Failed to fetch claim details' });
  }
});

/**
 * POST /api/dashboard/claims/:claimId/manual-review
 * Trigger manual review for a claim
 * 
 * Body:
 * - reason: Reason for manual review (required)
 * - priority: Priority level (urgent/normal/training, default: normal)
 */
router.post('/claims/:claimId/manual-review', verifyAccessCode, async (req: Request, res: Response) => {
  try {
    const { claimId } = req.params;
    const { reason, priority = 'normal' } = req.body;
    
    if (!claimId) {
      return res.status(400).json({ error: 'Claim ID is required' });
    }
    
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }
    
    // Get claim to extract decision data
    const claimResult = await database.query(
      'SELECT inspection_data FROM claim_inspections WHERE id = $1',
      [claimId]
    );
    
    if (claimResult.rowCount === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    
    const inspectionData = claimResult.rows[0].inspection_data || {};
    const decision = inspectionData.decision as DecisionResult;
    
    if (!decision) {
      return res.status(400).json({ error: 'No decision available for this claim' });
    }
    
    // Create manual review
    const review = await manualReviewService.createManualReview({
      claimId,
      triggerReasons: [reason],
      triggerSource: 'insurer_initiated',
      priority: priority as 'urgent' | 'normal' | 'training',
      machineAssessmentSnapshot: decision,
      manualTriggerReason: reason,
    });
    
    loggers.app.info('Manual review triggered from dashboard', {
      claimId,
      reviewId: review.reviewId,
      reason,
    });
    
    return res.json({
      success: true,
      reviewId: review.reviewId,
      message: 'Manual review triggered successfully',
    });
  } catch (error) {
    loggers.app.error('Failed to trigger manual review', error as Error);
    return res.status(500).json({ error: 'Failed to trigger manual review' });
  }
});

/**
 * POST /api/dashboard/claims/:claimId/resend-notification
 * Resend notification to the policyholder
 */
router.post('/claims/:claimId/resend-notification', verifyAccessCode, async (req: Request, res: Response) => {
  try {
    const { claimId } = req.params;
    
    if (!claimId) {
      return res.status(400).json({ error: 'Claim ID is required' });
    }
    
    // Get claim details
    const claimResult = await database.query(
      'SELECT id, claim_number, policyholder_mobile, policyholder_name, internal_status FROM claim_inspections WHERE id = $1',
      [claimId]
    );
    
    if (claimResult.rowCount === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    
    const claim = claimResult.rows[0];
    
    // Only allow resend for claims that haven't completed
    if (claim.internal_status === 'decision_complete') {
      return res.status(400).json({ error: 'Cannot resend notification for completed claims' });
    }
    
    // Update notification delivery record
    await database.query(
      `INSERT INTO notification_deliveries (id, claim_id, channel, recipient, status, sent_at)
       VALUES (gen_random_uuid(), $1, 'sms', $2, 'sent', NOW())
       ON CONFLICT (claim_id) DO UPDATE SET sent_at = NOW(), status = 'sent'`,
      [claimId, claim.policyholder_mobile]
    );
    
    loggers.app.info('Notification resent from dashboard', {
      claimId,
      claimNumber: claim.claim_number,
      recipient: claim.policyholder_mobile,
    });
    
    return res.json({
      success: true,
      message: 'Notification resent successfully',
    });
  } catch (error) {
    loggers.app.error('Failed to resend notification', error as Error);
    return res.status(500).json({ error: 'Failed to resend notification' });
  }
});

/**
 * GET /api/dashboard/metrics
 * Get dashboard metrics
 */
router.get('/metrics', verifyAccessCode, async (req: Request, res: Response) => {
  try {
    // Total claims
    const totalClaimsResult = await database.query('SELECT COUNT(*) FROM claim_inspections');
    const totalClaims = parseInt(totalClaimsResult.rows[0].count);
    
    // Claims by status
    const statusResult = await database.query(`
      SELECT external_status, COUNT(*) as count
      FROM claim_inspections
      GROUP BY external_status
    `);
    
    const claimsByStatus = statusResult.rows.reduce((acc: any, row: any) => {
      acc[row.external_status] = parseInt(row.count);
      return acc;
    }, {});
    
    // Average turnaround time (from received to decision complete)
    const turnaroundResult = await database.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (updated_at - received_at)) / 3600) as avg_hours
      FROM claim_inspections
      WHERE internal_status = 'decision_complete'
    `);
    
    const avgTurnaroundHours = turnaroundResult.rows[0].avg_hours 
      ? parseFloat(turnaroundResult.rows[0].avg_hours)
      : 0;
    
    // Automation rate (claims with automated decisions vs manual review)
    const automationResult = await database.query(`
      SELECT 
        COUNT(*) FILTER (WHERE inspection_data->>'decision' IS NOT NULL) as automated,
        COUNT(*) as total
      FROM claim_inspections
      WHERE internal_status IN ('decision_complete', 'awaiting_manual_review')
    `);
    
    const automationRate = automationResult.rows[0].total > 0
      ? parseFloat(((automationResult.rows[0].automated / automationResult.rows[0].total) * 100).toFixed(1))
      : 0;
    
    // Manual review statistics
    const reviewStats = await manualReviewService.getReviewStatistics();
    
    return res.json({
      totalClaims,
      claimsByStatus,
      avgTurnaroundHours: parseFloat(avgTurnaroundHours.toFixed(2)),
      automationRate: parseFloat(automationRate.toFixed(1)),
      manualReview: {
        queueSize: reviewStats.pendingReviews,
        overrideRate: (reviewStats.overrideRate * 100).toFixed(1),
        avgReviewTimeMinutes: reviewStats.averageReviewTimeMinutes.toFixed(1),
      },
    });
  } catch (error) {
    loggers.app.error('Failed to fetch metrics', error as Error);
    return res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * GET /api/dashboard/export
 * Export claims data as CSV or JSON
 * 
 * Query params:
 * - format: csv or json (default: csv)
 * - status: Filter by status (optional)
 * - dateFrom: Filter by date range (optional)
 * - dateTo: Filter by date range (optional)
 */
router.get('/export', verifyAccessCode, async (req: Request, res: Response) => {
  try {
    const { format = 'csv', status, dateFrom, dateTo } = req.query;
    
    let query = `
      SELECT 
        ci.claim_number,
        ci.insurer_id,
        ci.policyholder_name,
        ci.policyholder_mobile,
        ci.policyholder_email,
        ci.external_status,
        ci.internal_status,
        ci.received_at,
        ci.created_at,
        ci.updated_at,
        ci.inspection_data->>'decision' as decision,
        nd.sent_at as notification_sent_at,
        nd.status as notification_status
      FROM claim_inspections ci
      LEFT JOIN notification_deliveries nd ON ci.id::text = nd.claim_id
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let paramIndex = 1;
    
    if (status) {
      query += ` AND ci.external_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    if (dateFrom) {
      query += ` AND ci.received_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }
    
    if (dateTo) {
      query += ` AND ci.received_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }
    
    query += ` ORDER BY ci.received_at DESC`;
    
    const result = await database.query(query, params);
    
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="claims-export-${Date.now()}.json"`);
      return res.json(result.rows);
    }
    
    // CSV format
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No data to export' });
    }
    
    const headers = Object.keys(result.rows[0]);
    const csvRows = [
      headers.join(','),
      ...result.rows.map((row: any) => 
        headers.map(header => {
          const value = row[header];
          // Escape commas and quotes in CSV
          if (value === null || value === undefined) return '';
          const stringValue = String(value);
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        }).join(',')
      ),
    ];
    
    const csv = csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="claims-export-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (error) {
    loggers.app.error('Failed to export claims', error as Error);
    return res.status(500).json({ error: 'Failed to export claims' });
  }
});

export default router;
