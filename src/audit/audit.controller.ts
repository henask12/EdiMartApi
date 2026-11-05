import { Controller, Get, Query } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { AuditService } from "./audit.service";

@Controller("audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermissions(PermissionKey.AUDIT_VIEW)
  @Get()
  list(
    @Query("action") action?: string,
    @Query("entity") entity?: string,
    @Query("userId") userId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.audit.list({
      action,
      entity,
      userId,
      from,
      to,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }
}
