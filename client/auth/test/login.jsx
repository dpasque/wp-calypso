/**
 * @jest-environment jsdom
 */

/**
 * External dependencies
 */
import React from 'react';
import { expect } from 'chai';
import { shallow } from 'enzyme';

/**
 * Internal dependencies
 */
import { Auth } from '../login';
import { makeAuthRequest } from '../login-request';
import FormButton from 'calypso/components/forms/form-button';

const noop = () => {};

jest.mock( '../login-request', () => ( {
	makeAuthRequest: require( 'sinon' ).stub(),
	bumpStats: () => {},
	errorTypes: {},
} ) );

jest.mock( 'calypso/lib/analytics/ga', () => ( {
	gaRecordEvent: () => {},
} ) );

describe( 'LoginTest', () => {
	const page = shallow( <Auth translate={ ( string ) => string } /> );

	test( 'OTP is not present on first render', () => {
		return new Promise( ( done ) => {
			page.setState( { requires2fa: false }, function () {
				expect( page.find( { name: 'auth_code' } ) ).to.have.length( 0 );
				done();
			} );
		} );
	} );

	test( 'can submit without login details entered', () => {
		expect( page.find( FormButton ).props().disabled ).to.be.false;
	} );

	test( 'shows OTP box with valid login', () => {
		return new Promise( ( done ) => {
			page.setState( { login: 'test', password: 'test', requires2fa: true }, function () {
				page.update();
				expect( page.find( { name: 'auth_code' } ) ).to.have.length( 1 );
				done();
			} );
		} );
	} );

	test( 'prevents change of login when asking for OTP', () => {
		return new Promise( ( done ) => {
			page.setState( { login: 'test', password: 'test', requires2fa: true }, function () {
				expect( page.find( { name: 'login' } ).props().disabled ).to.be.true;
				expect( page.find( { name: 'password' } ).props().disabled ).to.be.true;
				done();
			} );
		} );
	} );

	test( 'submits login form', () => {
		return new Promise( ( done ) => {
			page.setState( { login: 'user', password: 'pass', auth_code: 'otp' }, function () {
				page.find( 'form' ).simulate( 'submit', { preventDefault: noop, stopPropagation: noop } );

				expect( makeAuthRequest ).to.have.been.calledOnce;
				expect( makeAuthRequest.calledWith( 'user', 'pass', 'otp' ) ).to.be.true;
				done();
			} );
		} );
	} );
} );
