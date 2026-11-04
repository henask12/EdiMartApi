import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { LabelsService } from "./labels.service";
import { IsArray, IsString } from "class-validator";

class MarkPrintedDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

@Controller("labels")
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @RequirePermissions(PermissionKey.LABELS_PRINT)
  @Get("pending")
  pending(
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.labels.listPending({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.LABELS_PRINT)
  @Post("printed")
  markPrinted(@Body() body: MarkPrintedDto) {
    return this.labels.markPrinted(body.ids);
  }
}
