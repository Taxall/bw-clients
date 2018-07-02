import {
    Component,
    EventEmitter,
    Output,
    ViewChild,
} from '@angular/core';

import { Router } from '@angular/router';

import { ToasterService } from 'angular2-toaster';
import { Angulartics2 } from 'angulartics2';

import { ApiService } from 'jslib/abstractions/api.service';
import { CryptoService } from 'jslib/abstractions/crypto.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';

import { PaymentComponent } from './payment.component';

import { PlanType } from 'jslib/enums/planType';
import { OrganizationCreateRequest } from 'jslib/models/request/organizationCreateRequest';

@Component({
    selector: 'app-create-organization',
    templateUrl: 'create-organization.component.html',
})
export class CreateOrganizationComponent {
    @ViewChild(PaymentComponent) paymentComponent: PaymentComponent;

    selfHosted = false;
    ownedBusiness = false;
    storageGbPriceMonthly = 0.33;
    additionalStorage = 0;
    additionalSeats = 0;
    plan = 'free';
    interval = 'year';
    name: string;
    billingEmail: string;
    businessName: string;

    storageGb: any = {
        price: 0.33,
        monthlyPrice: 0.50,
        yearlyPrice: 4,
    };

    plans: any = {
        free: {
            basePrice: 0,
            noAdditionalSeats: true,
            noPayment: true,
        },
        families: {
            basePrice: 1,
            annualBasePrice: 12,
            baseSeats: 5,
            noAdditionalSeats: true,
            annualPlanType: PlanType.FamiliesAnnually,
        },
        teams: {
            basePrice: 5,
            annualBasePrice: 60,
            monthlyBasePrice: 8,
            baseSeats: 5,
            seatPrice: 2,
            annualSeatPrice: 24,
            monthlySeatPrice: 2.5,
            monthPlanType: PlanType.TeamsMonthly,
            annualPlanType: PlanType.TeamsAnnually,
        },
        enterprise: {
            seatPrice: 3,
            annualSeatPrice: 36,
            monthlySeatPrice: 4,
            monthPlanType: PlanType.EnterpriseMonthly,
            annualPlanType: PlanType.EnterpriseAnnually,
        },
    };

    formPromise: Promise<any>;

    constructor(private apiService: ApiService, private i18nService: I18nService,
        private analytics: Angulartics2, private toasterService: ToasterService,
        platformUtilsService: PlatformUtilsService, private cryptoService: CryptoService,
        private router: Router) {
        this.selfHosted = platformUtilsService.isSelfHost();
    }

    async submit() {
        let key: string = null;
        let collectionCt: string = null;

        try {
            this.formPromise = this.cryptoService.makeShareKey().then((shareKey) => {
                key = shareKey[0].encryptedString;
                return this.cryptoService.encrypt('Default Collection', shareKey[1]);
            }).then((collection) => {
                collectionCt = collection.encryptedString;
                if (this.plan === 'free') {
                    return null;
                } else {
                    return this.paymentComponent.createPaymentToken();
                }
            }).then((token: string) => {
                const request = new OrganizationCreateRequest();
                request.key = key;
                request.collectionName = collectionCt;
                request.name = this.name;
                request.billingEmail = this.billingEmail;

                if (this.plan === 'free') {
                    request.planType = PlanType.Free;
                } else {
                    request.paymentToken = token;
                    request.businessName = this.ownedBusiness ? this.businessName : null;
                    request.additionalSeats = this.additionalSeats;
                    request.additionalStorageGb = this.additionalStorage;
                    request.country = this.paymentComponent.getCountry();
                    if (this.interval === 'month') {
                        request.planType = this.plans[this.plan].monthPlanType;
                    } else {
                        request.planType = this.plans[this.plan].annualPlanType;
                    }
                }

                return this.apiService.postOrganization(request);
            }).then((response) => {
                return this.finalize(response.id);
            });
            await this.formPromise;
        } catch { }
    }

    async finalize(orgId: string) {
        this.apiService.refreshIdentityToken();
        this.analytics.eventTrack.next({ action: 'Created Organization' });
        this.toasterService.popAsync('success', this.i18nService.t('organizationCreated'),
            this.i18nService.t('organizationReadyToGo'));
        this.router.navigate(['/organizations/' + orgId]);
    }

    changedPlan() {
        if (this.plans[this.plan].monthPlanType == null) {
            this.interval = 'year';
        }

        if (this.plans[this.plan].noAdditionalSeats) {
            this.additionalSeats = 0;
        } else if (!this.additionalSeats && !this.plans[this.plan].baseSeats &&
            !this.plans[this.plan].noAdditionalSeats) {
            this.additionalSeats = 1;
        }
    }

    changedOwnedBusiness() {
        if (!this.ownedBusiness || this.plan === 'teams' || this.plan === 'enterprise') {
            return;
        }
        this.plan = 'teams';
    }

    additionalStorageTotal(annual: boolean): number {
        if (annual) {
            return (this.additionalStorage || 0) * this.storageGb.yearlyPrice;
        } else {
            return (this.additionalStorage || 0) * this.storageGb.monthlyPrice;
        }
    }

    seatTotal(annual: boolean): number {
        if (this.plans[this.plan].noAdditionalSeats) {
            return 0;
        }

        if (annual) {
            return this.plans[this.plan].annualSeatPrice * (this.additionalSeats || 0);
        } else {
            return this.plans[this.plan].monthlySeatPrice * (this.additionalSeats || 0);
        }
    }

    baseTotal(annual: boolean): number {
        if (annual) {
            return (this.plans[this.plan].annualBasePrice || 0);
        } else {
            return (this.plans[this.plan].monthlyBasePrice || 0);
        }
    }

    get total(): number {
        const annual = this.interval === 'year';
        return this.baseTotal(annual) + this.seatTotal(annual) + this.additionalStorageTotal(annual);
    }
}
