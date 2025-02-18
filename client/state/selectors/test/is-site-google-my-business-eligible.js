/**
 * Internal dependencies
 */
import { siteHasEligibleWpcomPlan } from '../is-site-google-my-business-eligible';
import {
	PLAN_FREE,
	PLAN_BLOGGER,
	PLAN_BLOGGER_2_YEARS,
	PLAN_PERSONAL,
	PLAN_PERSONAL_2_YEARS,
	PLAN_PREMIUM,
	PLAN_PREMIUM_2_YEARS,
	PLAN_BUSINESS_MONTHLY,
	PLAN_BUSINESS,
	PLAN_BUSINESS_2_YEARS,
	PLAN_ECOMMERCE,
	PLAN_ECOMMERCE_2_YEARS,
} from '@automattic/calypso-products';
import selectors from 'calypso/state/sites/selectors';

jest.mock( 'calypso/state/sites/selectors', () => ( {
	getSitePlanSlug: jest.fn(),
} ) );

describe( 'siteHasEligibleWpcomPlan()', () => {
	test( 'should return true if site has eligible WP.com plan', () => {
		const plans = [
			PLAN_BUSINESS,
			PLAN_BUSINESS_2_YEARS,
			PLAN_BUSINESS_MONTHLY,
			PLAN_ECOMMERCE,
			PLAN_ECOMMERCE_2_YEARS,
		];

		plans.forEach( ( plan ) => {
			selectors.getSitePlanSlug.mockImplementation( () => plan );

			expect( siteHasEligibleWpcomPlan() ).toBe( true );
		} );
	} );

	test( 'should return false if site does not have an eligible WP.com plan', () => {
		const plans = [
			PLAN_FREE,
			PLAN_BLOGGER,
			PLAN_BLOGGER_2_YEARS,
			PLAN_PERSONAL,
			PLAN_PERSONAL_2_YEARS,
			PLAN_PREMIUM,
			PLAN_PREMIUM_2_YEARS,
		];

		plans.forEach( ( plan ) => {
			selectors.getSitePlanSlug.mockImplementation( () => plan );

			expect( siteHasEligibleWpcomPlan() ).toBe( false );
		} );
	} );
} );
